import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SelfApp } from '@selfxyz/qrcode'
import Navbar from './components/Navbar'
import DisclosureControls, {
  DEFAULT_DISCLOSURE_OPTIONS,
  buildSelfDisclosures,
  type DisclosureOptions,
} from './components/DisclosureControls'
import { apiGet, apiPost } from './lib/api'
import { ensureSelfEndpoint } from './config'
import { useAuth } from './context/AuthContext'
import './App.css'

const SelfQRcodeWrapper = lazy(async () => {
  const mod = await import('@selfxyz/qrcode')
  return { default: mod.SelfQRcodeWrapper }
})

type Step = 'input' | 'qr' | 'verifying' | 'success'

enum RegisterError {
  MissingHandle = 'Please enter a handle',
}

export default function App() {
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [handle, setHandle] = useState<string>('')
  const [disclosureOptions, setDisclosureOptions] = useState<DisclosureOptions>(
    DEFAULT_DISCLOSURE_OPTIONS
  )
  const [step, setStep] = useState<Step>('input')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const isMountedRef = useRef(true)
  const { user, isVerified, login } = useAuth()

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const handleStartRegistration = async () => {
    const trimmedHandle = handle.trim().toLowerCase()

    if (!trimmedHandle) {
      setError(RegisterError.MissingHandle)
      return
    }

    try {
      setError(null)
      const endpoint = ensureSelfEndpoint()

      const response = await apiPost<{ userId: string; handle: string; avatarUrl: string }>(
        '/auth/register/init',
        { handle: trimmedHandle }
      )

      setHandle(response.handle)
      setUserId(response.userId)

      const { SelfAppBuilder } = await import('@selfxyz/qrcode')
      const disclosures = buildSelfDisclosures(disclosureOptions)
      const app = new SelfAppBuilder({
        version: 2,
        appName: 'zkTwitter',
        scope: 'zktwitter',
        endpoint,
        logoBase64: 'https://i.postimg.cc/mrmVf9hm/self.png',
        userId: response.userId,
        endpointType: 'staging_https',
        userIdType: 'uuid',
        userDefinedData: JSON.stringify({
          action: 'registration',
          handle: response.handle,
          userId: response.userId,
        }),
        disclosures,
      }).build()

      setSelfApp(app)
      setStep('qr')
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to start registration')
      }
    }
  }

  const handleSuccessfulVerification = async () => {
    console.log('[handleSuccessfulVerification] Called with handle:', handle, 'userId:', userId)
    if (!handle || !userId) {
      setError('Missing registration context, please start again.')
      setStep('input')
      return
    }

    setStep('verifying')
    try {
      console.log('[handleSuccessfulVerification] Starting pollRegistrationStatus for handle:', handle)
      const verified = await pollRegistrationStatus(handle)
      console.log('[handleSuccessfulVerification] pollRegistrationStatus returned:', verified)
      if (verified) {
        // User is now logged in, redirect to timeline
        console.log('[handleSuccessfulVerification] Verified! Navigating to /timeline')
        navigate('/timeline')
      } else {
        setError(
          'Proof verified but the badge is still propagating. Refresh the timeline in a few seconds if it is not visible yet.'
        )
        setStep('success')
      }
    } catch (err) {
      console.error('[handleSuccessfulVerification] Error:', err)
      setError(err instanceof Error ? err.message : 'Verification failed')
      setStep('input')
    }
  }

  const pollRegistrationStatus = async (userHandle: string) => {
    console.log('[pollRegistrationStatus] Starting to poll for handle:', userHandle)
    const deadline = Date.now() + 90_000
    let pollCount = 0
    while (Date.now() < deadline && isMountedRef.current) {
      try {
        pollCount++
        console.log(`[pollRegistrationStatus] Poll attempt #${pollCount} for handle:`, userHandle)
        const status = await apiGet<{
          status: string
          token?: string
          user?: {
            id: string
            handle: string
            avatarUrl: string
            humanStatus: string
            disclosed: Record<string, unknown>
            selfNullifier?: string | null
            generationId?: number | null
            socialProofLevel?: number | null
            socialVerifiedAt?: string | null
          }
        }>(`/auth/register/status/${userHandle}`)
        console.log('[pollRegistrationStatus] Received status:', status.status, 'has token:', !!status.token, 'has user:', !!status.user)
        if (status.status === 'verified' && status.token && status.user) {
          // Auto-login after successful registration
          console.log('[pollRegistrationStatus] Status verified! Calling login()')
          login(status.token, status.user)
          return true
        }
      } catch (err) {
        console.warn('[pollRegistrationStatus] Poll failed:', err)
      }
      await delay(2000)
    }
    console.log(`[pollRegistrationStatus] Polling timed out after ${pollCount} attempts`)
    return false
  }

  const handleError = (failure: { error_code?: string; reason?: string }) => {
    setError(failure.reason || failure.error_code || 'Verification failed')
    setStep('input')
  }

  const showAlreadyVerified = user && isVerified && step === 'input'

  return (
    <div className="app">
      <Navbar />

      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <header className="hero">
        <h1>Sign Up</h1>
        <p>
          Verify your humanity with your passport. Zero-knowledge proofs keep your data private.
        </p>
      </header>

      <main className="registration-grid">
        <section className="card onboarding" aria-live="polite">
          {showAlreadyVerified && (
            <div className="already-verified">
              <h2>You're already verified</h2>
              <p>Jump back into the timeline or onboard a teammate with a fresh handle.</p>
              <div className="already-actions">
                <Link to="/timeline" className="cta primary">
                  View timeline
                </Link>
                <button className="cta tertiary" onClick={() => window.location.reload()}>
                  Register another human
                </button>
              </div>
            </div>
          )}

          {!showAlreadyVerified && step === 'input' && (
            <>
              <h2>Register with Passport</h2>
              <p className="subtitle">Reserve a handle and mint your green badge in under a minute.</p>

              <div className="form">
                <label htmlFor="handle">Choose a handle</label>
                <div className="input-row">
                  <span>@</span>
                  <input
                    id="handle"
                    type="text"
                    inputMode="text"
                    placeholder="alice"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleStartRegistration()
                      }
                    }}
                  />
                </div>
                <DisclosureControls value={disclosureOptions} onChange={setDisclosureOptions} />
                <button className="cta primary" onClick={() => void handleStartRegistration()}>
                  Generate verification QR
                </button>
              </div>

              <div className="checklist">
                <h3>How it works</h3>
                <ul>
                  <li><span>1</span> Generate a QR that encodes the Self verification request.</li>
                  <li><span>2</span> Scan it with the Self mobile app (mock passport available for testing).</li>
                  <li><span>3</span> Self verifies your passport and the checks you enabled (age, OFAC, etc.).</li>
                  <li><span>4</span> zkTwitter stores only your handle + green badge metadata.</li>
                </ul>
              </div>
            </>
          )}

          {step === 'qr' && (
            <div className="qr-step">
              <h2>Scan with the Self app</h2>
              <p className="subtitle">Enable mock passport mode (tap the passport icon five times) before scanning.</p>
              <Suspense fallback={<div className="qr-fallback">Preparing a secure payload…</div>}>
                {selfApp ? (
                  <div className="qr-container">
                    <SelfQRcodeWrapper
                      selfApp={selfApp}
                      onSuccess={handleSuccessfulVerification}
                      onError={handleError}
                      size={320}
                      darkMode={false}
                    />
                  </div>
                ) : (
                  <div className="qr-fallback">Generating QR code…</div>
                )}
              </Suspense>
              <button className="cta tertiary" onClick={() => setStep('input')}>
                Start over
              </button>
            </div>
          )}

          {step === 'verifying' && (
            <div className="status-card">
              <div className="spinner" aria-hidden />
              <h2>Verifying your proof…</h2>
              <p>Keep this tab open. We’ll update automatically when the Self relayer completes the round trip.</p>
            </div>
          )}

          {step === 'success' && (
            <div className="status-card success">
              <h2>Registration complete</h2>
              <p>Your passport proof cleared Self’s verifier. Log in now to join the global timeline.</p>
              <div className="summary">
                <div>
                  <h4>We stored</h4>
                  <ul>
                    <li>@{handle}</li>
                    <li>Verified badge</li>
                    <li>Your chosen disclosure fields</li>
                  </ul>
                </div>
                <div>
                  <h4>We never stored</h4>
                  <ul>
                    <li>Passport number or MRZ</li>
                    <li>Full name or exact DOB</li>
                    <li>Photo or biometric data</li>
                  </ul>
                </div>
              </div>
              <div className="success-actions">
                <Link to="/login" className="cta primary">
                  Log in and post
                </Link>
                <Link to="/timeline" className="cta secondary">
                  View timeline
                </Link>
              </div>
            </div>
          )}
        </section>

        <aside className="card explainer">
          <h3>Why zkTwitter?</h3>
          <p>
            zkTwitter is a privacy-preserving social feed where every green badge corresponds to a
            passport proof verified by the Self Protocol. Bots are allowed—but they’re labelled and
            siloed.
          </p>
          <ul>
            <li><strong>Selective disclosure</strong> reveals only high-signal traits like country or 21+.</li>
            <li><strong>No PII storage</strong> thanks to zero-knowledge proofs and TEE-backed verification.</li>
            <li><strong>All-to-all timeline</strong> ensures you never miss posts from verified humans or bots.</li>
          </ul>
          <div className="explainer-footer">
            <span>Need docs?</span>
            <a href="https://docs.self.xyz/" target="_blank" rel="noreferrer">
              Visit Self developer hub
            </a>
          </div>
        </aside>
      </main>

      <footer>
        <p>Powered by Self Protocol • Built for Succinct</p>
      </footer>
    </div>
  )
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

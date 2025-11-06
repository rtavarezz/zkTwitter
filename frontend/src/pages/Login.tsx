import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SelfApp } from '@selfxyz/qrcode'
import Navbar from '../components/Navbar'
import { apiGet, apiPost } from '../lib/api'
import { ensureSelfEndpoint } from '../config'
import { useAuth } from '../context/AuthContext'
import './Login.css'

const SelfQRcodeWrapper = lazy(async () => {
  const mod = await import('@selfxyz/qrcode')
  return { default: mod.SelfQRcodeWrapper }
})

type Step = 'input' | 'qr' | 'verifying' | 'success'

type LoginInitResponse = {
  sessionId: string
  userId: string
  handle: string
}

type LoginStatusResponse = {
  status: string
  token: string | null
  user: {
    id: string
    handle: string
    avatarUrl: string | null
    humanStatus: string
    disclosed: Record<string, unknown>
  } | null
}

export default function Login() {
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null)
  const [handle, setHandle] = useState('')
  const [step, setStep] = useState<Step>('input')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { login, refreshFromStorage, user, isVerified } = useAuth()
  const isMountedRef = useRef(true)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    refreshFromStorage()
    return () => {
      isMountedRef.current = false
    }
  }, [refreshFromStorage])

  const handleStartLogin = async () => {
    const normalized = handle.trim().toLowerCase()
    if (!normalized) {
      setError('Please enter your handle')
      return
    }

    try {
      setError(null)
      const endpoint = ensureSelfEndpoint()
      const response = await apiPost<LoginInitResponse>('/auth/login/init', { handle: normalized })
      setHandle(response.handle)

      const { SelfAppBuilder } = await import('@selfxyz/qrcode')
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
          action: 'login',
          handle: response.handle,
          userId: response.userId,
          sessionId: response.sessionId,
        }),
        disclosures: {
          excludedCountries: [],
          ofac: true,
          nationality: true,
        },
      }).build()

      setSelfApp(app)
      sessionIdRef.current = response.sessionId
      setStep('qr')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start login')
    }
  }

  const handleSuccessfulLogin = async () => {
    const currentSessionId = sessionIdRef.current
    console.log('[handleSuccessfulLogin] Called with sessionId:', currentSessionId)
    if (!currentSessionId) {
      setError('Missing login session context. Please try again.')
      setStep('input')
      return
    }

    setStep('verifying')
    try {
      const result = await pollLoginStatus(currentSessionId)
      if (result?.user) {
        login(result.token, result.user)
      } else {
        setError('Proof verified but token propagation is lagging. The timeline may take a moment to unlock.')
      }
      setStep('success')
      setTimeout(() => navigate('/timeline'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setStep('input')
    }
  }

  const pollLoginStatus = async (
    id: string
  ): Promise<{ token: string; user: LoginStatusResponse['user'] } | null> => {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && isMountedRef.current) {
      try {
        const status = await apiGet<LoginStatusResponse>(`/auth/login/status/${id}`)
        if (status.status === 'verified' && status.token) {
          console.log('[pollLoginStatus] Verified!')
          return { token: status.token, user: status.user }
        }
      } catch (err) {
        // Continue polling
      }
      await delay(2000)
    }
    console.log('[pollLoginStatus] Timed out')
    return null
  }

  const handleError = (failure: { error_code?: string; reason?: string }) => {
    setError(failure.reason || failure.error_code || 'Verification failed')
    setStep('input')
  }

  const alreadyLoggedIn = user && isVerified

  return (
    <div className="login-app">
      <Navbar />

      {error && <div className="toast" onClick={() => setError(null)}>{error}</div>}

      <header className="login-hero">
        <div className="login-copy">
          <span className="pill">Returning human</span>
          <h1>Scan once, unlock the feed.</h1>
          <p>
            Log in by scanning a fresh QR code with the Self app. We verify the proof, update your
            badge, and hand you a JWT for the timeline.
          </p>
        </div>
      </header>

      <main className="login-grid">
        <section className="card login-card" aria-live="polite">
          {alreadyLoggedIn && step === 'input' ? (
            <div className="already-verified">
              <h2>You're already signed in</h2>
              <p>Head straight to the timeline or refresh your verification for peace of mind.</p>
              <div className="already-actions">
                <Link to="/timeline" className="cta primary">
                  Open timeline
                </Link>
                <button className="cta tertiary" onClick={() => setStep('input')}>
                  Re-run verification
                </button>
              </div>
            </div>
          ) : null}

          {step === 'input' && !alreadyLoggedIn && (
            <>
              <h2>Log in with your passport</h2>
              <p className="subtitle">We’ll generate a QR code linked to your latest session.</p>
              <div className="form">
                <label htmlFor="handle">Your handle</label>
                <div className="input-row">
                  <span>@</span>
                  <input
                    id="handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="alice"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleStartLogin()
                      }
                    }}
                  />
                </div>
                <button className="cta primary" onClick={() => void handleStartLogin()}>
                  Generate login QR
                </button>
              </div>
              <div className="checklist">
                <h3>What happens next</h3>
                <ul>
                  <li><span>1</span> Self app scans the QR and fetches your stored passport credential.</li>
                  <li><span>2</span> A fresh proof is generated inside a TEE.</li>
                  <li><span>3</span> We refresh your verification timestamp and issue a 7-day JWT.</li>
                </ul>
              </div>
            </>
          )}

          {step === 'qr' && (
            <div className="qr-step">
              <h2>Scan the QR code</h2>
              <p className="subtitle">Make sure you’re in Self’s staging environment with mock passport enabled.</p>
              <Suspense fallback={<div className="qr-fallback">Preparing QR code…</div>}>
                {selfApp ? (
                  <div className="qr-container">
                    <SelfQRcodeWrapper
                      selfApp={selfApp}
                      onSuccess={handleSuccessfulLogin}
                      onError={handleError}
                      size={320}
                      darkMode={false}
                    />
                  </div>
                ) : (
                  <div className="qr-fallback">Generating secure payload…</div>
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
              <p>We’re waiting for Self’s relayer to confirm the QR session. Keep this window open.</p>
            </div>
          )}

          {step === 'success' && (
            <div className="status-card success">
              <h2>Login successful</h2>
              <p>Your badge is refreshed and you’re being redirected to the timeline.</p>
              <Link to="/timeline" className="cta primary">
                Jump to timeline now
              </Link>
            </div>
          )}
        </section>

        <aside className="card explainer">
          <h3>Why re-verify?</h3>
          <p>Each login issues a brand-new JWT keyed to your latest Self verification, keeping bots locked out.</p>
          <ul>
            <li><strong>Temporal proofs</strong> ensure your credentials are still valid.</li>
            <li><strong>Device-agnostic</strong> — scan from the Self app on any phone.</li>
            <li><strong>Privacy preserved</strong> — the frontend never touches your passport data.</li>
          </ul>
          <div className="explainer-footer">
            <span>Need the app?</span>
            <a href="https://docs.self.xyz/" target="_blank" rel="noreferrer">
              Self mobile setup guide
            </a>
          </div>
        </aside>
      </main>
    </div>
  )
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

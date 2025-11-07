import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import './Profile.css'

interface DisclosedInfo {
  country?: string
  is21?: boolean
}

interface SocialSnapshot {
  followerCount: number
  followingCount: number
  isFollowing: boolean
  followsYou: boolean
}

interface UserProfile {
  id: string
  handle: string
  avatarUrl: string | null
  humanStatus: 'verified' | 'unverified' | 'bot'
  disclosed: DisclosedInfo
  verifiedAt: string | null
  socialProofLevel?: number | null
  socialVerifiedAt?: string | null
  createdAt: string
  social: SocialSnapshot
}

type ProfileResponse = {
  user: UserProfile
}

export default function Profile() {
  const { handle } = useParams<{ handle: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const { user: currentUser } = useAuth()

  useEffect(() => {
    if (!handle) return
    setLoading(true)
    void (async () => {
      try {
        const data = await apiGet<ProfileResponse>(`/users/${handle}`)
        setProfile(data.user)
        setLoadError(null)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    })()
  }, [handle])

  useEffect(() => {
    const targetHandle = searchParams.get('follow')
    if (targetHandle && targetHandle !== handle) {
      navigate(`/profile/${targetHandle}`)
    }
  }, [searchParams, navigate, handle])

  const joined = useMemo(() => {
    if (!profile) return ''
    return new Date(profile.createdAt).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    })
  }, [profile])


  const isCurrentUser = Boolean(profile && currentUser?.handle === profile.handle)
  const isHuman = profile?.humanStatus === 'verified'

  const followDisabled = followBusy || !currentUser || !profile || isCurrentUser

  const handleFollowToggle = useCallback(async () => {
    if (!profile || !currentUser || isCurrentUser) {
      return
    }

    setFollowBusy(true)
    try {
      if (profile.social.isFollowing) {
        const data = await apiDelete<{ social: SocialSnapshot }>(`/users/${profile.handle}/follow`)
        setProfile((prev) => (prev ? { ...prev, social: data.social } : prev))
      } else {
        const data = await apiPost<{ social: SocialSnapshot }>(`/users/${profile.handle}/follow`, {})
        setProfile((prev) => (prev ? { ...prev, social: data.social } : prev))
      }
      setBanner(null)
    } catch (err) {
      console.error(err)
      setBanner(err instanceof Error ? err.message : 'Unable to update follow state')
    } finally {
      setFollowBusy(false)
    }
  }, [profile, currentUser, isCurrentUser])

  if (loading) {
    return (
      <div className="profile-app">
        <Navbar />
        <main className="profile-shell">
          <div className="profile-status">Loading profile…</div>
        </main>
      </div>
    )
  }

  if (loadError || !profile) {
    return (
      <div className="profile-app">
        <Navbar />
        <main className="profile-shell">
          <div className="profile-status error">{loadError ?? 'User not found'}</div>
        </main>
      </div>
    )
  }

  const disclosed = profile.disclosed
  const countryFlag = getCountryFlag(disclosed.country)
  const socialProofLevel = profile.socialProofLevel ?? 0
  const socialBadgeLabel = socialProofLevel > 0 ? `Social Verified (${socialProofLevel}+)` : null

  return (
    <div className="profile-app">
      <Navbar />
      <main className="profile-shell">
        <section className="profile-card" aria-live="polite">
          {banner && (
            <div className="profile-toast" role="alert" onClick={() => setBanner(null)}>
              {banner}
            </div>
          )}
          <header className="profile-hero">
            <div className="profile-avatar-wrapper">
              <img
                src={profile.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.handle}`}
                alt={profile.handle}
              />
              {isHuman && <span className="profile-badge" aria-label="Verified human" />}
            </div>
            <div className="profile-heading">
              <h1>@{profile.handle}</h1>
              <p className="profile-subtitle">
                {isHuman ? 'Verified' : profile.humanStatus === 'bot' ? 'Bot account' : 'Verification pending'}
                {disclosed.is21 ? ' • Age 21+' : ''}
                {socialBadgeLabel ? ` • ${socialBadgeLabel}` : ''}
              </p>
              <div className="profile-metadata">
                <span><strong>{profile.social.followerCount}</strong> Followers</span>
                <span><strong>{profile.social.followingCount}</strong> Following</span>
                {profile.social.followsYou && !isCurrentUser ? <span>Follows you</span> : null}
              </div>
            </div>
            <div className="profile-actions">
              {isCurrentUser ? (
                <button className="cta secondary" onClick={() => navigate('/timeline')}>
                  Open timeline
                </button>
              ) : (
                <>
                  <button
                    className={`cta ${profile.social.isFollowing ? 'secondary' : 'primary'}`}
                    disabled={followDisabled}
                    onClick={() => void handleFollowToggle()}
                  >
                    {followBusy ? 'Saving…' : profile.social.isFollowing ? 'Following' : 'Follow'}
                  </button>
                  <button
                    className="cta tertiary"
                    onClick={() => navigate(`/messages?with=${profile.handle}`)}
                  >
                    Message
                  </button>
                </>
              )}
            </div>
          </header>

          <div className="profile-section">
            <h2>About this account</h2>
            <ul className="profile-details">
              <li>
                <span className="icon">📅</span>
                <div>
                  <strong>Date joined</strong>
                  <p>{joined}</p>
                </div>
              </li>
              <li>
                <span className="icon">📍</span>
                <div>
                  <strong>Account based in</strong>
                  <p>{disclosed.country ? `${countryFlag} ${disclosed.country}` : 'Not disclosed'}</p>
                </div>
              </li>
              {disclosed.is21 && (
                <li>
                  <span className="icon">🎂</span>
                  <div>
                    <strong>Age verification</strong>
                    <p>21+ years old</p>
                  </div>
                </li>
              )}
              <li>
                <span className="icon">🔐</span>
                <div>
                  <strong>Connected via</strong>
                  <p>Self Protocol Passport Verification</p>
                </div>
              </li>
              <li>{/* Mirror the generation + social proof badges we persist for this account */}
                <span className="icon">🛡️</span>
                <div>
                  <strong>Social proof badge</strong>
                  <p>
                    {socialBadgeLabel
                      ? `${socialBadgeLabel}${profile.socialVerifiedAt ? ` • issued ${new Date(profile.socialVerifiedAt).toLocaleDateString()}` : ''}`
                      : 'Not yet proven'}
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}

function getCountryFlag(country?: string) {
  if (!country) return '🌍'
  const map: Record<string, string> = {
    USA: '🇺🇸',
    'United States': '🇺🇸',
    CAN: '🇨🇦',
    Canada: '🇨🇦',
    GBR: '🇬🇧',
    'United Kingdom': '🇬🇧',
    FRA: '🇫🇷',
    DEU: '🇩🇪',
    GER: '🇩🇪',
    JPN: '🇯🇵',
    MEX: '🇲🇽',
    BRA: '🇧🇷',
    IND: '🇮🇳',
  }
  return map[country] ?? '🌍'
}

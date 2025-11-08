
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { apiGet, apiPost } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import './Timeline.css'

interface DisclosedInfo {
  country?: string
  is21?: boolean
}

interface User {
  id: string
  handle: string
  avatarUrl: string | null
  humanStatus: 'verified' | 'unverified' | 'bot'
  disclosed: DisclosedInfo
  generationId?: number | null
  socialProofLevel?: number | null
}

interface Tweet {
  id: string
  content: string
  createdAt: string
  user: User
}

const GENERATIONS = [
  { id: 0, name: 'Gen Z' },
  { id: 1, name: 'Millennial' },
  { id: 2, name: 'Gen X' },
  { id: 3, name: 'Boomer' },
  { id: 4, name: 'Silent' },
];

const SOCIAL_THRESHOLDS = [
  { value: 2, label: '2+ verified follows' },
  { value: 4, label: '4+ verified follows' },
  { value: 8, label: '8+ verified follows' },
];

export default function Timeline() {
  const { user, token, isVerified } = useAuth()
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [newTweet, setNewTweet] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generationFilter, setGenerationFilter] = useState<number | null>(null)
  const [socialFilter, setSocialFilter] = useState<number | null>(null)

  useEffect(() => {
    void refreshTweets()
    // eslint-disable-next-line
  }, [generationFilter, socialFilter])


  const refreshTweets = async (cursor?: string) => {
    const isPagination = Boolean(cursor)
    if (isPagination) setLoadingMore(true)
    else setLoading(true)

    try {
      let url = '/tweets'
      const params = new URLSearchParams()
      if (cursor) params.append('cursor', cursor)
      if (generationFilter !== null) params.append('generation', generationFilter.toString())
      if (socialFilter !== null) params.append('socialProof', socialFilter.toString())
      if (params.toString()) url += `?${params.toString()}`

      const data = await apiGet<{
        tweets: Tweet[]
        hasMore: boolean
        nextCursor: string | null
      }>(url)

      if (isPagination) {
        setTweets((prev) => [...prev, ...data.tweets])
      } else {
        setTweets(data.tweets)
      }
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const handleLoadMore = () => {
    if (nextCursor && !loadingMore) {
      void refreshTweets(nextCursor)
    }
  }

  const handlePostTweet = async () => {
    if (!newTweet.trim() || posting) return
    if (!user || !isVerified || !token) {
      setError('You must be a verified human to post.')
      return
    }
    setPosting(true)
    try {
      console.log('[Timeline] Posting tweet:', newTweet)
      await apiPost('/tweets', { content: newTweet })
      setNewTweet('')
      await refreshTweets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post tweet')
    } finally {
      setPosting(false)
    }
  }

  function getCountryFlag(country?: string) {
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
    return country && map[country] ? `${map[country]} ${country}` : country ?? ''
  }

  function formatTime(dateStr: string) {
    const date = new Date(dateStr)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const handleUnauthenticatedAction = () => {
    setError('Please log in or sign up to post')
    setTimeout(() => setError(null), 3000)
  }

  const getGenerationName = (genId?: number | null) => {
    if (genId === null || genId === undefined) return null
    return GENERATIONS.find(g => g.id === genId)?.name
  }

  const handleGenerationFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value === '' ? null : parseInt(e.target.value)
    // Anyone can filter by generation - it's a public filter
    setGenerationFilter(value)
  }

  const handleSocialFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value === '' ? null : parseInt(e.target.value)
    setSocialFilter(value)
  }

  return (
    <div className="timeline-page">
      <Navbar />
      <div className="timeline-shell">
        <section className="timeline-feed" aria-live="polite">
          <div className="generation-filter">
            <label htmlFor="gen-filter">Filter by generation:</label>
            <select
              id="gen-filter"
              value={generationFilter === null ? '' : generationFilter}
              onChange={handleGenerationFilterChange}
            >
              <option value="">All generations</option>
              {GENERATIONS.map(gen => (
                <option key={gen.id} value={gen.id}>{gen.name}</option>
              ))}
            </select>
            <label htmlFor="social-filter">Social badge:</label>
            <select
              id="social-filter"
              value={socialFilter === null ? '' : socialFilter}
              onChange={handleSocialFilterChange}
            >
              <option value="">All badges</option>
              {SOCIAL_THRESHOLDS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {user && isVerified && (user.generationId === null || user.generationId === undefined) && (
              <Link to="/generation-proof" className="cta secondary" style={{ marginLeft: 'auto' }}>
                Prove Generation
              </Link>
            )}
            {user && isVerified && (
              <Link to="/social" className="cta tertiary" style={{ marginLeft: '0.5rem' }}>
                Social Proof
              </Link>
            )}
            {user && user.generationId !== null && user.generationId !== undefined && (
              <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '0.9rem' }}>
                Verified: {GENERATIONS.find(g => g.id === user.generationId)?.name}
              </span>
            )}
            {user && (user.socialProofLevel ?? 0) > 0 && (
              <span style={{ marginLeft: '0.5rem', color: '#94a3b8', fontSize: '0.9rem' }}>
                Social Verified ({user.socialProofLevel}+)
              </span>
            )}
          </div>

          {user && isVerified ? (
            <div className="composer">
              <img
                src={user.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.handle}`}
                alt={user.handle}
                className="avatar"
              />
              <div className="composer-body">
                <textarea
                  placeholder="Share something with zkTwitter…"
                  maxLength={280}
                  value={newTweet}
                  onChange={(e) => setNewTweet(e.target.value)}
                  disabled={posting}
                />
                <div className="composer-actions">
                  <span>{280 - newTweet.length} characters left</span>
                  <button className="cta primary" disabled={!newTweet.trim() || posting} onClick={handlePostTweet}>
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="composer-locked">
              <textarea
                placeholder="What's happening?"
                maxLength={280}
                onClick={handleUnauthenticatedAction}
                readOnly
              />
              <div className="composer-actions">
                <span></span>
                <button className="cta primary" onClick={handleUnauthenticatedAction}>
                  Post
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="timeline-placeholder">Loading timeline…</div>
          ) : tweets.length === 0 ? (
            <div className="timeline-placeholder">No posts yet. Be the first verified voice to say hi!</div>
          ) : (
            tweets.map((tweet) => {
              const disclosed = tweet.user.disclosed
              const flag = getCountryFlag(disclosed.country)
              const isHuman = tweet.user.humanStatus === 'verified'
              const isBot = tweet.user.humanStatus === 'bot'

              const genName = getGenerationName(tweet.user.generationId)
              return (
                <article key={tweet.id} className="tweet-card">
                  <div className="tweet-avatar">
                    <img
                      src={tweet.user.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tweet.user.handle}`}
                      alt={tweet.user.handle}
                    />
                    {isHuman && <span className="halo" aria-hidden />}
                    {isBot && <span className="bot-chip">BOT</span>}
                  </div>
                  <div className="tweet-body">
                    <header>
                      <Link to={`/profile/${tweet.user.handle}`} className="handle">
                        @{tweet.user.handle}
                      </Link>
                      <time dateTime={tweet.createdAt}>{formatTime(tweet.createdAt)}</time>
                    </header>
                    <p>{tweet.content}</p>
                    <footer className="tweet-badges">{/* Badge chips mirror every verified attribute we store */}
                      {isHuman ? (
                        <>
                          <span className="badge human">Verified</span>
                          {flag && <span className="badge secondary">{flag}</span>}
                          {disclosed.is21 && <span className="badge secondary">21+</span>}
                          {genName && <span className="badge generation">{genName}</span>}
                          {(tweet.user.socialProofLevel ?? 0) > 0 && (
                            <span className="badge social">Social {tweet.user.socialProofLevel}+</span>
                          )}
                          {(tweet.user.socialProofLevel ?? 0) > 0 && tweet.user.socialVerifiedAt && (
                            <span className="badge primary" title="SP1 aggregated proof">SP1</span>
                          )}
                        </>
                      ) : (
                        <span className="badge bot">Bot account</span>
                      )}
                    </footer>
                  </div>
                </article>
              )
            })
          )}

          {hasMore && (
            <div className="load-more">
              <button onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          {error && <div className="toast" onClick={() => setError(null)}>{error}</div>}
        </section>
      </div>
    </div>
  )
}

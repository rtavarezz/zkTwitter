
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
}

interface Tweet {
  id: string
  content: string
  createdAt: string
  user: User
}

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

  useEffect(() => {
    void refreshTweets()
    // eslint-disable-next-line
  }, [])


  const refreshTweets = async (cursor?: string) => {
    const isPagination = Boolean(cursor)
    if (isPagination) setLoadingMore(true)

    try {
      const data = await apiGet<{
        tweets: Tweet[]
        hasMore: boolean
        nextCursor: string | null
      }>(cursor ? `/tweets?cursor=${cursor}` : '/tweets')

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

  return (
    <div className="timeline-page">
      <Navbar />
      <div className="timeline-shell">
        <section className="timeline-feed" aria-live="polite">
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
                    <footer>
                      {isHuman ? (
                        <span className="badge human">
                          Verified {flag ? `• ${flag}` : ''}{disclosed.is21 ? ' • 21+' : ''}
                        </span>
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

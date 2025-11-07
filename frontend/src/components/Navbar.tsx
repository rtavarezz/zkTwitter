import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Navbar.css'

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, isVerified } = useAuth()

  useEffect(() => {
    if (user) {
      document.body.classList.add('has-bottom-nav')
    } else {
      document.body.classList.remove('has-bottom-nav')
    }
    return () => {
      document.body.classList.remove('has-bottom-nav')
    }
  }, [user])

  const isActive = (path: string) => {
    return location.pathname === path ? 'active' : ''
  }

  return (
    <>
      <nav className="navbar-top">
        <div className="navbar-top-inner">
          <Link to="/timeline" className="navbar-brand">
            zkTwitter
          </Link>

          <div className="navbar-actions">
            {user ? (
              <>
                <Link to={`/profile/${user.handle}`} className="navbar-handle">
                  @{user.handle}
                </Link>
                <button
                  className="cta tertiary"
                  onClick={() => {
                    logout()
                    navigate('/timeline')
                  }}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="navbar-link">
                  Log in
                </Link>
                <Link to="/signup" className="cta primary small">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {user ? (
        <nav className="navbar-bottom">
          <Link
            to="/timeline"
            className={`nav-item ${isActive('/timeline')}`}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M12 9c-2.209 0-4 1.791-4 4s1.791 4 4 4 4-1.791 4-4-1.791-4-4-4zm0 6c-1.105 0-2-.895-2-2s.895-2 2-2 2 .895 2 2-.895 2-2 2zm0-13.304L.622 8.807l1.06 1.696L3 9.679V19.5C3 20.881 4.119 22 5.5 22h13c1.381 0 2.5-1.119 2.5-2.5V9.679l1.318.824 1.06-1.696L12 1.696zM19 19.5c0 .276-.224.5-.5.5h-13c-.276 0-.5-.224-.5-.5V8.429l7-4.375 7 4.375V19.5z"/>
            </svg>
            <span>Home</span>
          </Link>

          {isVerified ? (
            <Link
              to="/social"
              className={`nav-item ${isActive('/social')}`}
            >
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M12 2l9 4v6.5c0 5.25-3.94 9.92-9 10.5-5.06-.58-9-5.25-9-10.5V6l9-4zm0 2.18L5 7.09v5.41c0 4.34 3.07 8.08 7 8.58 3.93-.5 7-4.24 7-8.58V7.09l-7-2.91zm0 3.82c1.93 0 3.5 1.57 3.5 3.5 0 2.8-3.5 6.5-3.5 6.5s-3.5-3.7-3.5-6.5c0-1.93 1.57-3.5 3.5-3.5zm0 2c-.83 0-1.5.67-1.5 1.5 0 .52.27 1.18.74 1.92.37.56.75 1.03.76 1.03.01 0 .39-.47.76-1.03.47-.74.74-1.4.74-1.92 0-.83-.67-1.5-1.5-1.5z"/>
              </svg>
              <span>Social</span>
            </Link>
          ) : null}

          <Link
            to="/messages"
            className={`nav-item ${isActive('/messages')}`}
            onClick={(e) => {
              if (!isVerified) {
                e.preventDefault()
                navigate('/login')
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M1.998 5.5c0-1.381 1.119-2.5 2.5-2.5h15c1.381 0 2.5 1.119 2.5 2.5v13c0 1.381-1.119 2.5-2.5 2.5h-15c-1.381 0-2.5-1.119-2.5-2.5v-13zm2.5-.5c-.276 0-.5.224-.5.5v2.764l8 3.638 8-3.636V5.5c0-.276-.224-.5-.5-.5h-15zm15.5 5.463l-8 3.636-8-3.638V18.5c0 .276.224.5.5.5h15c.276 0 .5-.224.5-.5v-8.037z"/>
            </svg>
            <span>Messages</span>
          </Link>

          <Link
            to={`/profile/${user.handle}`}
            className={`nav-item ${isActive(`/profile/${user.handle}`)}`}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M5.651 19h12.698c-.337-1.8-1.023-3.21-1.945-4.19C15.318 13.65 13.838 13 12 13s-3.317.65-4.404 1.81c-.922.98-1.608 2.39-1.945 4.19zm.486-5.56C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46zM12 4c-1.105 0-2 .9-2 2s.895 2 2 2 2-.9 2-2-.895-2-2-2zM8 6c0-2.21 1.791-4 4-4s4 1.79 4 4-1.791 4-4 4-4-1.79-4-4z"/>
            </svg>
            <span>Profile</span>
          </Link>
        </nav>
      ) : null}
    </>
  )
}

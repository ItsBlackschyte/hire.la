'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import CitySelector from './CitySelector';
import RoleSelect from './RoleSelect';
import CompanySelect from './CompanySelect';
import { GearIcon, PanelIcon, UserIcon } from './icons';
import { MAP_STYLES, setMapStyle, useMapStyle } from '@/lib/settings';
import { avatarUrl, displayName, signInWithGoogle, signOut, useUser } from '@/lib/auth';

const COLLAPSE_KEY = 'hire-la:sidebar-collapsed';

/**
 * App navigation. Desktop (≥ 900px): a left rail that collapses to icons.
 * Mobile: the same markup renders as a top bar + a row of selectors.
 *
 *   ┌──────────────────────┐
 *   │ [mark] hire.la   [⊟] │  head: brand + collapse toggle
 *   │ Country ▾            │
 *   │ City    ▾            │  body: selectors
 *   │ Role    ▾            │
 *   │                      │
 *   │ (◯) Sign in      [⚙] │  foot: account + settings
 *   └──────────────────────┘
 */
export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<'none' | 'settings' | 'account'>('none');
  const mapStyle = useMapStyle();
  const user = useUser();
  const rootRef = useRef<HTMLElement>(null);
  const avatar = user ? avatarUrl(user) : null;

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    if (new URLSearchParams(window.location.search).get('signin') === '1') setMenu('account');
  }, []);

  function toggle() {
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
    setMenu('none');
  }

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (menu === 'none') return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu('none');
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu('none');
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <aside ref={rootRef} className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-head">
        <Link href="/" className="brand" aria-label="hire.la home">
          <span className="brand-text">
            hire<span className="wordmark-tld">.la</span>
          </span>
        </Link>
        <button
          className="icon-btn sidebar-toggle"
          onClick={(e) => {
            e.currentTarget.blur();
            toggle();
          }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <PanelIcon />
        </button>
      </div>

      <div className="sidebar-body">
        <Suspense fallback={null}>
          <CitySelector />
          <RoleSelect />
          <CompanySelect />
        </Suspense>
      </div>

      <div className="sidebar-foot">
        <button
          className="user-btn"
          onClick={() => setMenu(menu === 'account' ? 'none' : 'account')}
          aria-haspopup="dialog"
          aria-expanded={menu === 'account'}
        >
          <span className="user-avatar">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon />
            )}
          </span>
          <span className="btn-text">{user ? displayName(user) : 'Sign in'}</span>
        </button>
        <button
          className="icon-btn"
          onClick={() => setMenu(menu === 'settings' ? 'none' : 'settings')}
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={menu === 'settings'}
        >
          <GearIcon />
        </button>
      </div>

      {menu === 'settings' && (
        <div className="popover" role="dialog" aria-label="Settings">
          <p className="popover-title">Map style</p>
          <div className="radio-list">
            {MAP_STYLES.map((s) => (
              <label key={s.id} className="radio-row">
                <input
                  type="radio"
                  name="map-style"
                  checked={mapStyle === s.id}
                  onChange={() => setMapStyle(s.id)}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <div className="popover-links">
            <Link href="/about">About</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
      )}

      {menu === 'account' && !user && (
        <div className="popover" role="dialog" aria-label="Sign in">
          <p className="popover-title">Sign in</p>
          <p className="popover-text">Save jobs and get alerts for new roles in your city.</p>
          <button className="google-btn" onClick={() => signInWithGoogle()}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.1 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v8.1h12.7c-.3 2.1-1.7 5.3-4.8 7.4l7.4 5.7c4.4-4.1 7.2-10.1 7.2-17.2z"/>
              <path fill="#FBBC05" d="M10.4 28.8A14.6 14.6 0 0 1 9.6 24c0-1.7.3-3.3.8-4.8l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6z"/>
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.7-3.6-13.6-8.6l-7.8 6C6.5 42.6 14.6 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
          <p className="popover-fine">We only use your Google account to sign you in. No emails unless you ask for job alerts.</p>
        </div>
      )}

      {menu === 'account' && user && (
        <div className="popover" role="dialog" aria-label="Account">
          <p className="popover-title">{displayName(user)}</p>
          <p className="popover-text">{user.email}</p>
          <div className="popover-links popover-links-col">
            <Link href="/saved" onClick={() => setMenu('none')}>Saved jobs</Link>
            <button className="link-button" onClick={() => signOut()}>Sign out</button>
          </div>
        </div>
      )}
    </aside>
  );
}

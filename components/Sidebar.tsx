'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import CitySelector from './CitySelector';
import RoleSelect from './RoleSelect';
import { GearIcon, PanelIcon, UserIcon } from './icons';
import { MAP_STYLES, setMapStyle, useMapStyle } from '@/lib/settings';

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
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
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
        </Suspense>
      </div>

      <div className="sidebar-foot">
        <button
          className="user-btn"
          onClick={() => setMenu(menu === 'account' ? 'none' : 'account')}
          aria-haspopup="dialog"
          aria-expanded={menu === 'account'}
        >
          <span className="user-avatar"><UserIcon /></span>
          <span className="btn-text">Sign in</span>
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

      {menu === 'account' && (
        <div className="popover" role="dialog" aria-label="Account">
          <p className="popover-title">Accounts are coming</p>
          <p className="popover-text">
            Sign in to save jobs and get alerts when new roles appear near you. Not live yet — everything on
            the map works without an account.
          </p>
        </div>
      )}
    </aside>
  );
}

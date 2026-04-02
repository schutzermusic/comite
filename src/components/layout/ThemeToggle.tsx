'use client';

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle group"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <div className="theme-toggle-track">
        <div className={`theme-toggle-thumb ${isDark ? 'theme-toggle-thumb-dark' : 'theme-toggle-thumb-light'}`}>
          {isDark ? (
            <Moon className="w-3 h-3 text-cyan-200" />
          ) : (
            <Sun className="w-3 h-3 text-amber-600" />
          )}
        </div>
      </div>
    </button>
  );
}

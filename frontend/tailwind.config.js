/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mes: {
          50: '#f0f7ff',
          100: '#e0efff',
          500: '#0066cc',
          600: '#0055aa',
          700: '#004499',
          900: '#001f5c',
        },
        // Design-token surfaces — resolve to CSS vars so they adapt to dark mode.
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
        },
        'border-subtle': 'var(--border-subtle)',
      },
      boxShadow: {
        // Subtle elevation for popovers / dropdowns / menus.
        elevation: '0 4px 6px -2px rgb(0 0 0 / 0.05), 0 12px 28px -8px rgb(0 0 0 / 0.14)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    }
  },
  plugins: []
}

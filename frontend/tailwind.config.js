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
        }
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    }
  },
  plugins: []
}

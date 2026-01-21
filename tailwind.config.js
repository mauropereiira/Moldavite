/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Moldavite palette - forest greens
        moldavite: {
          50: '#f0f5f2',
          100: '#e0ebe4',
          200: '#c4d4c9',
          300: '#8a9a8f',
          400: '#5a9970',
          500: '#3d7a52',
          600: '#2d5a3d',
          700: '#1a3d2e',
          800: '#151d19',
          900: '#0a0f0d',
        },
        // Accent - Moldavite Green
        accent: {
          DEFAULT: '#2d5a3d',
          light: '#3d7a52',
          dark: '#1a3d2e',
          muted: '#5a9970',
          subtle: '#e8f0ec',
          glow: '#7cb992',
        },
        // Cosmic Gold accent
        gold: {
          DEFAULT: '#c9a227',
          light: '#e8b923',
          dark: '#a88620',
          muted: '#d4b74a',
        },
        // Legacy mappings for compatibility
        sidebar: {
          light: '#e8efe9',
          dark: '#131a16',
        },
        editor: {
          light: '#fafcfb',
          dark: '#0f1512',
        },
        panel: {
          light: '#f0f5f2',
          dark: '#0e1310',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['Space Mono', 'Geist Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        'te-sm': '2px',
        'te-md': '4px',
        'te-lg': '6px',
      },
      fontSize: {
        'te-xs': '10px',
        'te-sm': '12px',
        'te-base': '13px',
        'te-md': '14px',
      },
    },
  },
  plugins: [],
}

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
        // Graphite palette - warm grays
        graphite: {
          50: '#f8f8f7',
          100: '#f0f0ee',
          200: '#e8e8e6',
          300: '#d8d8d4',
          400: '#c0c0bc',
          500: '#8c8c88',
          600: '#5c5c58',
          700: '#3c3c38',
          800: '#2c2c2a',
          900: '#1c1c1a',
        },
        // Accent - Muted Steel Blue
        accent: {
          DEFAULT: '#4a7c9b',
          light: '#6a9cbb',
          dark: '#3d6a86',
          muted: '#a8c4d4',
          subtle: '#e8f0f5',
        },
        // Legacy mappings for compatibility
        sidebar: {
          light: '#f0f0ee',
          dark: '#222220',
        },
        editor: {
          light: '#ffffff',
          dark: '#262624',
        },
        panel: {
          light: '#f4f4f2',
          dark: '#1e1e1c',
        },
      },
      fontFamily: {
        sans: ['Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Menlo', 'monospace'],
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

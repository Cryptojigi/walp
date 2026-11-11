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
        near: {
          green: '#00EC97',
          dark: '#0e1117',
          card: '#161b22',
          border: '#30363d',
          muted: '#8b949e',
        }
      }
    },
  },
  plugins: [],
}


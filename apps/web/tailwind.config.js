/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        spiritual: {
          dark: '#0a0d14',
          card: '#121826',
          border: '#1f293d',
          gold: '#eab308',
          jade: '#10b981',
          qi: '#6366f1',
          crimson: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Cinzel', 'Outfit', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

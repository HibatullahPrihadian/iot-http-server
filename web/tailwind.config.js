/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ios: {
          blue: '#0a84ff',
          green: '#30d158',
          orange: '#ff9f0a',
          purple: '#bf5af2',
          red: '#ff453a',
          pink: '#ff375f',
          cyan: '#64d2ff',
        },
        surface: {
          bg: '#121212',
          panel: 'rgba(28,28,30,0.65)',
          sub: 'rgba(255,255,255,0.03)',
          line: 'rgba(255,255,255,0.08)',
        },
        text: {
          hi: '#ffffff',
          body: '#f2f2f7',
          mid: '#aeaeb2',
          low: '#8e8e93',
          dim: '#d1d1d6',
        },
        // Alias pendek dipakai komponen Plan (text-mid, dll.).
        hi: '#ffffff',
        body: '#f2f2f7',
        mid: '#aeaeb2',
        low: '#8e8e93',
        dim: '#d1d1d6',
      },
      backdropBlur: {
        glass: '24px',
      },
      borderRadius: {
        panel: '24px',
        sub: '18px',
        chip: '12px',
      },
      boxShadow: {
        glass: '0 10px 40px rgba(0,0,0,0.3)',
        'glow-blue': '0 4px 15px rgba(10,132,255,0.35)',
        'glow-green': '0 4px 15px rgba(48,209,88,0.35)',
        'glow-orange': '0 4px 15px rgba(255,159,10,0.35)',
        'glow-purple': '0 4px 15px rgba(191,90,242,0.35)',
        'glow-red': '0 4px 15px rgba(255,69,58,0.35)',
        'glow-pink': '0 4px 15px rgba(255,55,95,0.35)',
        'glow-cyan': '0 4px 15px rgba(100,210,255,0.35)',
      },
    },
  },
  plugins: [],
}

// Konfigurasi ikon PWA. Sumber tunggal: public/icon.svg.
// Regenerate semua aset dari direktori web:
//   npx --yes @vite-pwa/assets-generator
//
// `maskable` memakai padding 0 karena glyph di icon.svg sudah berada di area
// aman (sekitar 56% dari sisi), sehingga tidak ada tepi kotak yang terlihat
// saat peluncur memotong ikon menjadi lingkaran/rounded square.
export default {
  preset: {
    // padding 0: icon.svg sudah full-bleed dengan latar gelap, jadi tidak ada
    // bingkai transparan/putih di sekitar ikon.
    transparent: {
      sizes: [64, 192, 512],
      padding: 0,
      favicons: [[48, 'favicon.ico']],
    },
    maskable: {
      sizes: [512],
      padding: 0,
      resizeOptions: { background: '#121212' },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: '#121212' },
    },
  },
  images: ['public/icon.svg'],
}

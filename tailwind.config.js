/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: "#09090B",
          subtle: "#Use essa imagem como icone do app, e use a cor #18181B como fundo da splashscreen",
          elevated: "#27272A",
          stroke: "#3F3F46",
          strokeFocus: "#71717A",
        },
        brand: {
          white: "#FAFAFA",
          muted: "#A1A1AA",
          dim: "#71717A",
        },
        subject: {
          stem: "#3B82F6",
          premed: "#10B981",
          humanities: "#F59E0B",
          arts: "#A855F7",
          cram: "#F43F5E",
        },
        status: {
          danger: "#EF4444",
          success: "#22C55E",
        },
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "system-ui"],
        mono: ["SF Mono", "Geist Mono", "monospace"],
      },
    },
  },
  plugins: [],
};



export const IMAGE_STYLE_CATEGORIES = [
  { id: 'photorealistic', name: '📸 실사 (Photo)', range: [0, 9] },
  { id: '3d_art', name: '🎨 아트 (Art)', range: [10, 19] },
  { id: 'logo_branding', name: '✨ 브랜딩 (Logo)', range: [20, 29] },
  { id: 'business_text', name: '📝 비즈니스 (Text)', range: [30, 39] },
];

export const IMAGE_STYLES = [
  // 4.1. 초현실주의 실사 (0~9)
  { id: 0, label: "시네마틱 인물", prompt: "Cinematic portrait, neon lights, highly detailed, 8k" },
  { id: 1, label: "자연광 제품", prompt: "Minimalist product photography, soft morning sunlight, high key lighting" },
  { id: 2, label: "빈티지 필름", prompt: "1980s street photography, grainy film texture, Kodak Portra 400" },
  { id: 3, label: "야생 동물", prompt: "Macro photography, hyper-realistic, bokeh background" },
  { id: 4, label: "건축 인테리어", prompt: "Modern Scandinavian interior, sunset light, architectural photography" },
  { id: 5, label: "고급 시계", prompt: "Luxury wristwatch product shot, dramatic lighting, reflection highlights" },
  { id: 6, label: "디저트 푸드", prompt: "Close-up food photography, shallow depth of field, warm light" },
  { id: 7, label: "패션 룩북", prompt: "Full body street fashion, minimalist trench coat, film-like tones" },
  { id: 8, label: "자동차 광고", prompt: "Dynamic sports car, speeding on wet highway, motion blur, cinematic" },
  { id: 9, label: "드론 항공샷", prompt: "Aerial drone photography, mountain road, autumn forest, soft fog" },

  // 4.2. 3D & 일러스트 (10~19)
  { id: 10, label: "픽사 스타일", prompt: "Pixar style 3D character, soft pastel colors, volumetric lighting, octane render" },
  { id: 11, label: "사이버펑크", prompt: "Futuristic sci-fi city, neon blue and pink, isometric view, digital art" },
  { id: 12, label: "수채화 풍경", prompt: "Watercolor painting, soft brush strokes, dreamy atmosphere, paper texture" },
  { id: 13, label: "판타지 갑옷", prompt: "Fantasy armor concept art, intricate gold engravings, dark fantasy style" },
  { id: 14, label: "로우 폴리", prompt: "Low poly illustration, geometric shapes, vibrant colors, minimalist 3D" },
  { id: 15, label: "카툰 스타일", prompt: "Colorful cartoon illustration, bold outlines, flat shading, vector style" },
  { id: 16, label: "다크 판타지", prompt: "Dark fantasy landscape, ruined castle, stormy sky, moody atmosphere" },
  { id: 17, label: "일본 애니", prompt: "Anime illustration, sunset rooftop, detailed uniforms, cinematic composition" },
  { id: 18, label: "아이소메트릭", prompt: "Isometric office illustration, tiny characters, clean flat colors, vector art" },
  { id: 19, label: "3D 이모지", prompt: "3D rendered emoji icons, glossy material, soft studio lighting" },

  // 4.3. 로고 & 브랜딩 (20~29)
  { id: 20, label: "테크 로고", prompt: "Minimalist vector logo, tech startup, simple geometric shape, flat design" },
  { id: 21, label: "커피숍 엠블럼", prompt: "Vintage emblem logo, coffee bean line art, brown and cream colors" },
  { id: 22, label: "앱 아이콘", prompt: "Glossy 3D app icon, rounded corners, soft gradients, clean UI design" },
  { id: 23, label: "마스코트", prompt: "Esports mascot logo, fierce tiger, bold thick lines, vibrant colors" },
  { id: 24, label: "친환경 패턴", prompt: "Packaging pattern, seamless botanical leaves, eco-friendly green tones" },
  { id: 25, label: "뷰티 브랜드", prompt: "Elegant wordmark logo, thin serif font, black on white, minimal" },
  { id: 26, label: "핀테크 로고", prompt: "Flat vector logo, abstract shield shape, gradient blue, trustworthy" },
  { id: 27, label: "키즈 브랜드", prompt: "Playful mascot logo, cute dinosaur, pastel colors, thick outline" },
  { id: 28, label: "모노그램", prompt: "Monogram logo, intertwined lettering, golden foil effect, luxurious" },
  { id: 29, label: "채널 배너", prompt: "YouTube channel banner, bold typography, abstract geometric shapes" },
  
  // 4.4. 텍스트 카피 (30~39)
  { id: 30, label: "마케팅 문구", prompt: "Social media post layout, energetic vibe, bright colors" },
  { id: 31, label: "메일 헤더", prompt: "Professional email header design, clean and minimal" },
  { id: 32, label: "블로그 헤더", prompt: "Blog post header image, remote work theme, illustrative" },
  { id: 33, label: "제품 상세", prompt: "Product feature highlight graphic, clean layout, tech vibes" },
  { id: 34, label: "유튜브 썸네일", prompt: "YouTube video thumbnail, high contrast, bold text area" },
  { id: 35, label: "SaaS 히어로", prompt: "Website hero section background, SaaS theme, modern UI" },
  { id: 36, label: "광고 배너", prompt: "Google display ad banner, catchy graphic, call to action button" },
  { id: 37, label: "뉴스레터", prompt: "Newsletter header design, friendly illustration, reading theme" },
  { id: 38, label: "고객 후기", prompt: "Customer review card design, quote icon, profile picture placeholder" },
  { id: 39, label: "세일 배너", prompt: "Flash sale banner, urgent vibe, red and yellow accents" },
];

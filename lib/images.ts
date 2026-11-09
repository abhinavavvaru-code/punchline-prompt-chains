// Preset images shared with the Punchline main app. IDs must match existing
// public.caption_images rows; the database still decides whether one is active.
export type PresetImage = { id: string; title: string; src: string; alt: string; scene: string; photo: boolean }

export const PRESET_IMAGES: PresetImage[] = [
  { id: 'photo-coffee', title: 'Powered by coffee', src: '/photos/photo-coffee.jpg', photo: true,
    alt: 'A metal coffee cup and saucer beside an open laptop and a stack of reading material on a sunlit desk.',
    scene: 'A metal cup of coffee with foam and a spoon sits on a matching saucer beside an open laptop and a stack of reading material on a sunlit desk. A round wooden tray is partly visible.' },
  { id: 'photo-campus', title: 'Low battery, Low steps', src: '/photos/photo-campus.jpg', photo: true,
    alt: 'People gathered on the steps of Columbia University’s Low Memorial Library under a blue sky.',
    scene: 'People sit and walk on the broad steps outside Columbia University’s domed Low Memorial Library on a sunny day. Trees frame the building beneath a clear blue sky.' },
  { id: 'photo-library', title: 'Café syllabus', src: '/photos/photo-library.jpg', photo: true,
    alt: 'A stack of books on a café counter beside coffee equipment, glasses, and cups.',
    scene: 'A stack of books rests on a wooden café counter beside coffee grinders and stacked drinking glasses and cups. A small compass sign and a wooden box sit behind the books.' },
  { id: 'udp', title: 'Paper airplane', src: '/captions/udp.svg', photo: false, alt: 'Illustration of a paper airplane in a cloudy sky.',
    scene: 'A paper airplane carries a message across a cloudy sky toward an unknown destination.' },
  { id: 'dark-mode', title: 'Dark mode', src: '/captions/dark-mode.svg', photo: false, alt: 'Illustration of a laptop glowing at night with bugs around it.',
    scene: 'A laptop glows at night while tiny curious bugs gather around its screen.' },
  { id: 'gravity', title: 'Floating book', src: '/captions/gravity.svg', photo: false, alt: 'Illustration of an open book floating above a desk.',
    scene: 'An open book floats above a desk as loose pages drift upward.' },
  { id: 'interest', title: 'Piggy bank', src: '/captions/interest.svg', photo: false, alt: 'Illustration of a piggy bank beside a falling chart.',
    scene: 'A piggy bank sits beside a downward-sloping financial chart.' },
  { id: 'binary', title: 'Two robots', src: '/captions/binary.svg', photo: false, alt: 'Illustration of two robots marked one and zero.',
    scene: 'Two friendly robots, marked one and zero, stand together.' },
  { id: 'earth', title: 'Sunny Earth', src: '/captions/earth.svg', photo: false, alt: 'Illustration of a cheerful planet Earth.',
    scene: 'A cheerful planet Earth rotates in warm sunshine.' },
]

export const CAPTION_STYLES = ['dry', 'chaotic', 'wholesome', 'wordplay', 'roast'] as const
export type CaptionStyle = typeof CAPTION_STYLES[number]
export const STYLE_LABELS: Record<CaptionStyle, string> = { dry: 'Dry', chaotic: 'Chaotic', wholesome: 'Wholesome', wordplay: 'Wordplay', roast: 'Playful roast' }

export function imageSrc(image: { id: string; src: string; uploaded?: boolean }) {
  return image.uploaded ? `/api/images/${encodeURIComponent(image.id)}/file` : image.src
}

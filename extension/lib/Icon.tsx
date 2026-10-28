const paths: Record<string, string> = {
  play: 'M8 5l11 7-11 7z', pause: 'M8 5v14M16 5v14', stop: 'M7 7h10v10H7z',
  settings: 'M10 2h4l.7 3 2 1.2 2.9-.8 2 3.5-2.2 2.1v2l2.2 2.1-2 3.5-2.9-.8-2 1.2-.7 3h-4l-.7-3-2-1.2-2.9.8-2-3.5L4 13v-2L1.8 8.9l2-3.5 2.9.8 2-1.2.7-3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01', search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM16 16l5 5',
  arrow: 'M12 4v16M6 14l6 6 6-6', close: 'M6 6l12 12M6 18L18 6',
  overlay: 'M3 5h18v14H3zM7 12h10M9 15.5h6',
};
export default function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.play}/></svg>;
}

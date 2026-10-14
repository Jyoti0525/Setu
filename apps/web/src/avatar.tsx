/** Crops from the learner portrait reference supplied by the user.
 * Only the crop changes; source artwork and face proportions stay untouched. */
const legacyAvatar: Record<string, string> = {
  '👦': 'boy-1', '🧒': 'boy-2', '🧑‍🌾': 'boy-3', '🐯': 'boy-1',
  '👧': 'girl-1', '👩‍🎓': 'girl-2',
};

export function AvatarPortrait({ avatar, className = '' }: { avatar: string; className?: string }) {
  const id = legacyAvatar[avatar] ?? (/^(boy|girl)-[1-4]$/.test(avatar) ? avatar : 'girl-1');
  return <img class={className} src={`/avatars/${id}.png`} alt="" aria-hidden="true" draggable={false} />;
}

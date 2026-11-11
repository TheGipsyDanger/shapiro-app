let counter = 0;

export function generateId(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  const seq = counter.toString(36).padStart(4, '0');
  return `${prefix}_${time}_${seq}_${rand}`;
}


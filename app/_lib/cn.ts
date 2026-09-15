// BEACON — className merge helper (E8·T-345a). clsx for conditional classes + tailwind-merge to resolve
// conflicting Tailwind utilities deterministically. Used by every component; keeps class logic readable.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

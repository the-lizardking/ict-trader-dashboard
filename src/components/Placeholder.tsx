import { Construction } from 'lucide-react';

interface PlaceholderProps {
  title: string;
  description: string;
  bullets?: string[];
}

export default function Placeholder({ title, description, bullets }: PlaceholderProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <Construction className="text-amber-400 shrink-0 mt-0.5" size={20} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <p className="text-xs text-gray-400 mt-1">{description}</p>
          {bullets && bullets.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-gray-500 list-disc list-inside">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

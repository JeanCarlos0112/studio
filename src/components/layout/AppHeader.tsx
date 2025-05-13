import { Youtube } from 'lucide-react';

export function AppHeader() {
  return (
    <header className="py-6 mb-8">
      <div className="container mx-auto flex items-center justify-center space-x-3">
        <Youtube className="h-10 w-10 text-primary" />
        <h1 className="text-4xl font-bold text-primary tracking-tight">
          YouTube Audio Extractor
        </h1>
      </div>
    </header>
  );
}

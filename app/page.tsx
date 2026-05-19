import SoundAnalyzer from "@/components/SoundAnalyzer";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 bg-zinc-50 dark:bg-black font-sans">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
          Sound Checker
        </h1>
      </header>

      <main className="w-full max-w-2xl">
        <SoundAnalyzer />
      </main>

      <footer className="mt-16 text-zinc-500 text-sm">
        &copy; {new Date().getFullYear()} Sound Checker App
      </footer>
    </div>
  );
}

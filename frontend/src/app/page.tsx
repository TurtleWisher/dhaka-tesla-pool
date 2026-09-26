// Home page placeholder until the login and passenger/driver screens exist.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dhaka Tesla Pool</h1>
        <p className="mt-2 text-slate-600">Share a seat. Split the fare. Survive Dhaka traffic.</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Project skeleton is running</h2>
        <p className="mt-1 text-sm text-slate-600">
          Jashim and Bullet are warming up. Nusrat, Rafiq and Shirin can book rides once the
          passenger and driver screens are built.
        </p>
      </section>
    </main>
  );
}

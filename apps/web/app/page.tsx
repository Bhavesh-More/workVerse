import Link from "next/link";
import { AppNav } from "../components/AppNav";

export default function HomePage() {
  return (
    <div className="grid-canvas">
      <AppNav />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__title-group">
            <p className="hero__eyebrow">Practise the work</p>
            <h1 className="hero__title" id="hero-title">
              WorkVerse
            </h1>
          </div>

          <p className="hero__note hero__note--left">
            Enter a 2D office,
            <br />
            work a real incident,
            <br />
            get evidence-based feedback.
          </p>

          <p className="hero__note hero__note--right">
            Simulate first,
            <br />
            then reflect,
            <br />
            then improve.
          </p>

          <div className="hero__cta">
            <Link className="btn" href="/scenarios">
              Start practising
            </Link>
            <Link className="btn btn--ghost" href="/signup">
              Create account
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

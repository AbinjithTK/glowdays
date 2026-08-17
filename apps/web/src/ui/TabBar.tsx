/**
 * Bottom navigation. Three destinations, exactly as the guidelines specify.
 *
 * The raised centre circle is a link rather than a floating action button so it
 * keeps a real focus ring and a real label. The one permitted badge is a small
 * rose dot on Today when a result is waiting; there are deliberately no counts,
 * because a number here would turn a diary into a queue to clear.
 */

import { BookOpen, Camera, Home } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export function TabBar({ resultReady = false }: { resultReady?: boolean }) {
  return (
    <nav
      aria-label="Main"
      className="bg-paper border-line shrink-0 border-0 border-t border-solid px-6 py-2"
    >
      <div className="relative flex flex-row items-center justify-around">
        <NavLink
          to="/today"
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 ${isActive ? 'text-rose' : 'text-ink-soft'}`
          }
        >
          <span className="relative flex items-center justify-center rounded-lg px-4 py-1">
            <Home className="size-5" strokeWidth={1.5} />
            {resultReady ? (
              <>
                <span className="bg-rose absolute top-0 right-3 size-2 rounded-full" aria-hidden />
                <span className="sr-only">a result is ready</span>
              </>
            ) : null}
          </span>
          <span className="text-[11px] font-medium">Today</span>
        </NavLink>

        <NavLink to="/check-in" className="-mt-8 flex flex-col items-center gap-1">
          <span className="shadow-raised bg-rose flex size-14 items-center justify-center rounded-full">
            <Camera className="text-paper size-6" strokeWidth={1.5} />
          </span>
          <span className="text-ink-soft text-[11px] font-medium">Check-in</span>
        </NavLink>

        <NavLink
          to="/diary"
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 ${isActive ? 'text-rose' : 'text-ink-soft'}`
          }
        >
          <span className="flex items-center justify-center rounded-lg px-4 py-1">
            <BookOpen className="size-5" strokeWidth={1.5} />
          </span>
          <span className="text-[11px] font-medium">Diary</span>
        </NavLink>
      </div>
    </nav>
  );
}

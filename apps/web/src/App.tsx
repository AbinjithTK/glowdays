import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { api, loadToken, subscribeToken } from './lib/api.ts';
import { Capture } from './screens/Capture.tsx';
import { Diary } from './screens/Diary.tsx';
import { Me } from './screens/Me.tsx';
import { ScanDetail } from './screens/ScanDetail.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { Today } from './screens/Today.tsx';
import { NewTrial, TrialDetail, Trials } from './screens/Trials.tsx';
import { WhatChanged } from './screens/WhatChanged.tsx';
import { Headline, Lead, Screen, ScreenBody } from './ui/primitives.tsx';

/**
 * Subscribe to the token rather than reading it once per render.
 *
 * `loadToken()` called directly in a render body is a read of module state that
 * React is not watching, so a sign-in that set the token but did not also cause a
 * navigation left this component rendering the sign-in routes with a perfectly
 * valid session in hand.
 */
function useToken(): string | null {
  return useSyncExternalStore(subscribeToken, loadToken, () => null);
}

export function App() {
  const token = useToken();

  // A token in session storage is not proof of a valid session, so the account
  // call is what actually decides. It also creates the profile row on first
  // sight, which every other screen then assumes exists.
  const session = useQuery({
    queryKey: ['account'],
    queryFn: api.account,
    enabled: token !== null,
    retry: false,
  });

  if (token === null || session.isError) {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    );
  }

  if (session.isPending) {
    return (
      <Screen>
        <ScreenBody>
          <div className="flex flex-1 flex-col justify-center gap-2">
            <Headline>Opening your diary.</Headline>
            <Lead>One moment.</Lead>
          </div>
        </ScreenBody>
      </Screen>
    );
  }

  return (
    <Routes>
      <Route path="/today" element={<Today />} />
      <Route path="/check-in" element={<Capture />} />
      {/* Every one of these was linked to from a screen that shipped and had no
          route behind it, so the tap fell through to the catch-all and bounced
          silently back to Today. A dead control that looks alive is worse than an
          absent one. */}
      <Route path="/check-in/:id" element={<ScanDetail />} />
      <Route path="/diary" element={<Diary />} />
      <Route path="/me" element={<Me />} />
      <Route path="/trials" element={<Trials />} />
      <Route path="/trials/new" element={<NewTrial />} />
      <Route path="/trials/:id" element={<TrialDetail />} />
      <Route path="/what-changed" element={<WhatChanged />} />
      <Route path="/sign-in" element={<Navigate to="/today" replace />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

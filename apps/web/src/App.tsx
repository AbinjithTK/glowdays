import { useQuery } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { api, loadToken, subscribeToken } from './lib/api.ts';
import { Capture } from './screens/Capture.tsx';
import { Diary } from './screens/Diary.tsx';
import { Me } from './screens/Me.tsx';
import { Landing } from './screens/Landing.tsx';
import { OAuthFinish } from './screens/OAuthFinish.tsx';
import { hasOnboarded, Onboarding } from './screens/Onboarding.tsx';
import { SignUp } from './screens/SignUp.tsx';
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
  // Local, so completing the tour re-renders immediately rather than waiting on a
  // storage read that React does not observe.
  const [onboarded, setOnboarded] = useState(false);

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
        {/* The landing page is the root for anyone not signed in. Previously the root
            redirected straight to a sign-in form, which asked for an email address
            before saying what the product does. */}
        <Route path="/" element={<Landing />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        {/* Where Google returns. Reachable while unauthenticated by definition - it is
            the screen that obtains the session. */}
        <Route path="/oauth/finish" element={<OAuthFinish />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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

  /**
   * First run gets the tour, rendered inline rather than as a redirect.
   *
   * A route guard on a stored flag is one wrong condition away from stranding every
   * user outside the app, and this is the last thing standing between a new account
   * and the product. Rendering it in place keeps the router uninvolved, and Skip is
   * on every panel, so it can never become a wall.
   */
  const profileId = session.data?.profile.id;
  if (profileId && !onboarded && !hasOnboarded(profileId)) {
    return <Onboarding profileId={profileId} onDone={() => setOnboarded(true)} />;
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
      {/* Re-openable. Panel two is the only place the capture guidance that decides
          comparability is written down, and it is worth more than one reading. */}
      <Route
        path="/welcome"
        element={
          profileId ? (
            <Onboarding profileId={profileId} onDone={() => setOnboarded(true)} revisiting />
          ) : (
            <Navigate to="/today" replace />
          )
        }
      />
      {/* Signed in, so the public routes send you onward rather than showing a form
          you have already been through. */}
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="/sign-in" element={<Navigate to="/today" replace />} />
      <Route path="/sign-up" element={<Navigate to="/today" replace />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

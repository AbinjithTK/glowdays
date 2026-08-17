I wanted an app that tells you whether your skincare is actually working.

It works like this. You name the one product you're testing, before you take your first photo. Two weeks later you take another. Then it shows you what changed, with a confidence label next to it.

And if the two photos don't match well enough, it won't subtract them. It shows a screen saying it won't compare them, and why.

So I didn't start in a design tool. I started by writing the product. A UX spec. An architecture. A dataset, so every screen used the same real numbers.

The measurement comes from a real skin analysis API, and the API has rules. Two detail levels that must never be compared with each other. Readings that come back for four separate parts of the face, not as one number. Tasks that expire while you wait.

All of that had to show up in the interface. So I wrote it down before I drew anything.

Then I connected Flowstep over MCP and generated the screens straight from those documents, without leaving my editor.

Flowstep keeps a design guidelines file on the project. Every screen I generated after editing that file followed the new rules, and the screens already on the canvas stayed as they were. So I rewrote it five times and watched the design move each time.

One version used a bright, conventional palette. It looked like generated software, so I reverted it and wrote a rule against it.

Then something I didn't expect.

Because the plan and the design sat in the same place, I could check the screens against the architecture, and find what wasn't buildable.

The API returns pore readings for four regions of the face. My design showed one number and dropped the other three. So I added a breakdown by region.

And two photos taken at different detail levels can't be subtracted from each other. So I added a screen that refuses to compare them, and explains why.

The hard part was getting the screens to match the plan exactly.

Buttons and chips kept arriving with no styling. Asking for the same fix twice never worked. So I built a loop. Generate a screen. Look at the render. Read the code back out. Fix it by hand. Put it back.

Two screens in five went through that.

I also rebuilt the busiest screen at double text size. Sixty per cent of it fell off the bottom of the phone. That's the fixed version.

A hundred screens later, including every error state, the design is done.

And these aren't pictures. I can pull the code back out through the same connection and build the real app on any stack I want.

Every skincare app tells you your skin improved.

This one puts a confidence label on the answer. And when the photos don't line up, it refuses to give you a number.

Plan in the editor. Design in Flowstep. Code back out.

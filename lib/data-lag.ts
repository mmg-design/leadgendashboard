// How many days back each source's charts end, so the newest point is a
// complete day rather than a half-collected one that reads as a sudden drop.
// Google Analytics finishes processing a day within hours, so charts stop at
// yesterday. Search Console settles about three days behind.
export const GA_LAG_DAYS = 1;
export const GSC_LAG_DAYS = 3;

// Walkthrough videos shown on a client's progress page, keyed by client slug.
// Only clients listed here get the "Watch the guide" card.

export interface PortalGuide {
  title: string;
  note: string;
  embedUrl: string;
  previewImage: string; // a still from the video, saved in /public
  duration: string; // shown on the preview, e.g. "1:25"
}

export const PORTAL_GUIDES: Record<string, PortalGuide> = {
  "healthmap-solutions": {
    title: "How to use this page",
    note: "A walkthrough of how to use your progress report and feedback portal.",
    embedUrl: "https://www.tella.tv/video/vid_cmw2cahac002q02kb8lbndn9d/embed?b=1&title=1&a=1&loop=0&t=0&muted=0&wt=1&o=1",
    previewImage: "/clients/healthmap-solutions/guide-preview.jpg",
    duration: "1:25",
  },
};

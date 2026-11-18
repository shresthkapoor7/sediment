const SITE_URL = "https://www.sediment-ai.com";
const REPO_URL = "https://github.com/shresthkapoor7/sediment";
const DESCRIPTION =
  "Trace any research concept back through time. Enter any concept or paper and Sediment recursively compiles its intellectual ancestry, mapping the theoretical dependencies, seminal citations, and breakthroughs that made it possible.";

// Same @id as the Person node on shresth.space, so both sites resolve to one entity.
const author = {
  "@type": "Person",
  "@id": "https://shresth.space/#person",
  name: "Shresth Kapoor",
  url: "https://shresth.space",
  sameAs: [
    "https://github.com/shresthkapoor7",
    "https://www.linkedin.com/in/shresth-kapoor-7skp",
    "https://x.com/rested_7",
  ],
};

export const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Sediment",
      description: "Trace any research concept back through time.",
      inLanguage: "en",
      author,
      publisher: { "@id": author["@id"] },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      url: SITE_URL,
      name: "Sediment",
      alternateName: "Sediment: Knowledge, layered",
      description: DESCRIPTION,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      sameAs: [REPO_URL],
      isAccessibleForFree: true,
      author,
      creator: { "@id": author["@id"] },
    },
  ],
};

// Heuristic list of font families commonly available in Figma (the full Google
// Fonts library plus a few ubiquitous system faces). This is an APPROXIMATION —
// the authoritative check is `figma.listAvailableFontsAsync()` inside Figma,
// which the report can't run at extraction time. Used only to warn which fonts
// will likely fall back to Inter; never blocks conversion.
export const FIGMA_FONTS = new Set(
  [
    // Figma default + top Google Fonts
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway',
    'Nunito', 'Nunito Sans', 'Oswald', 'Merriweather', 'Playfair Display',
    'Source Sans Pro', 'Source Serif Pro', 'PT Sans', 'PT Serif', 'Roboto Mono',
    'Roboto Condensed', 'Roboto Slab', 'Ubuntu', 'Work Sans', 'Noto Sans',
    'Noto Serif', 'Rubik', 'Mulish', 'DM Sans', 'DM Serif Display', 'Inconsolata',
    'Fira Sans', 'Fira Code', 'Josefin Sans', 'Quicksand', 'Karla', 'Manrope',
    'Space Grotesk', 'Space Mono', 'IBM Plex Sans', 'IBM Plex Serif',
    'IBM Plex Mono', 'Barlow', 'Cabin', 'Bitter', 'Dosis', 'Heebo', 'Hind',
    'Libre Franklin', 'Libre Baskerville', 'Archivo', 'Assistant', 'Titillium Web',
    'Muli', 'Exo 2', 'Zilla Slab', 'Crimson Text', 'Cormorant Garamond', 'Lora',
    'Arimo', 'Figtree', 'Plus Jakarta Sans', 'Outfit', 'Sora', 'Epilogue',
    'Red Hat Display', 'Red Hat Text', 'Public Sans', 'Schibsted Grotesk',
    // Common system faces Figma ships
    'Arial', 'Helvetica', 'Helvetica Neue', 'Georgia', 'Times New Roman',
    'Courier New', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Georgia Pro',
  ].map((f) => f.toLowerCase()),
);

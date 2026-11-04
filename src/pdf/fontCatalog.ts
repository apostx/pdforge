import openSansRegular from '@expo-google-fonts/open-sans/400Regular/OpenSans_400Regular.ttf?url';
import openSansBold from '@expo-google-fonts/open-sans/700Bold/OpenSans_700Bold.ttf?url';
import arimoRegular from '@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf?url';
import arimoBold from '@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf?url';
import carlitoRegular from '@expo-google-fonts/carlito/400Regular/Carlito_400Regular.ttf?url';
import carlitoBold from '@expo-google-fonts/carlito/700Bold/Carlito_700Bold.ttf?url';
import robotoRegular from '@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf?url';
import robotoBold from '@expo-google-fonts/roboto/700Bold/Roboto_700Bold.ttf?url';
import notoSansRegular from '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url';
import notoSansBold from '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url';
import interRegular from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url';
import interBold from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url';
import sourceSans3Regular from '@expo-google-fonts/source-sans-3/400Regular/SourceSans3_400Regular.ttf?url';
import sourceSans3Bold from '@expo-google-fonts/source-sans-3/700Bold/SourceSans3_700Bold.ttf?url';
import montserratRegular from '@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf?url';
import montserratBold from '@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf?url';
import robotoCondensedRegular from '@expo-google-fonts/roboto-condensed/400Regular/RobotoCondensed_400Regular.ttf?url';
import robotoCondensedBold from '@expo-google-fonts/roboto-condensed/700Bold/RobotoCondensed_700Bold.ttf?url';
import sourceSerif4Regular from '@expo-google-fonts/source-serif-4/400Regular/SourceSerif4_400Regular.ttf?url';
import sourceSerif4Bold from '@expo-google-fonts/source-serif-4/700Bold/SourceSerif4_700Bold.ttf?url';
import tinosRegular from '@expo-google-fonts/tinos/400Regular/Tinos_400Regular.ttf?url';
import tinosBold from '@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf?url';
import gelasioRegular from '@expo-google-fonts/gelasio/400Regular/Gelasio_400Regular.ttf?url';
import gelasioBold from '@expo-google-fonts/gelasio/700Bold/Gelasio_700Bold.ttf?url';
import notoSerifRegular from '@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url';
import notoSerifBold from '@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf?url';
import ptSerifRegular from '@expo-google-fonts/pt-serif/400Regular/PTSerif_400Regular.ttf?url';
import ptSerifBold from '@expo-google-fonts/pt-serif/700Bold/PTSerif_700Bold.ttf?url';
import loraRegular from '@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf?url';
import loraBold from '@expo-google-fonts/lora/700Bold/Lora_700Bold.ttf?url';
import ebGaramondRegular from '@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf?url';
import ebGaramondBold from '@expo-google-fonts/eb-garamond/700Bold/EBGaramond_700Bold.ttf?url';
import playfairDisplayRegular from '@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf?url';
import playfairDisplayBold from '@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf?url';
import cousineRegular from '@expo-google-fonts/cousine/400Regular/Cousine_400Regular.ttf?url';
import cousineBold from '@expo-google-fonts/cousine/700Bold/Cousine_700Bold.ttf?url';
import robotoMonoRegular from '@expo-google-fonts/roboto-mono/400Regular/RobotoMono_400Regular.ttf?url';
import robotoMonoBold from '@expo-google-fonts/roboto-mono/700Bold/RobotoMono_700Bold.ttf?url';
import sourceCodeProRegular from '@expo-google-fonts/source-code-pro/400Regular/SourceCodePro_400Regular.ttf?url';
import sourceCodeProBold from '@expo-google-fonts/source-code-pro/700Bold/SourceCodePro_700Bold.ttf?url';
import caveatRegular from '@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf?url';
import caveatBold from '@expo-google-fonts/caveat/700Bold/Caveat_700Bold.ttf?url';
import dancingScriptRegular from '@expo-google-fonts/dancing-script/400Regular/DancingScript_400Regular.ttf?url';
import dancingScriptBold from '@expo-google-fonts/dancing-script/700Bold/DancingScript_700Bold.ttf?url';
import kalamRegular from '@expo-google-fonts/kalam/400Regular/Kalam_400Regular.ttf?url';
import kalamBold from '@expo-google-fonts/kalam/700Bold/Kalam_700Bold.ttf?url';
import comicNeueRegular from '@expo-google-fonts/comic-neue/400Regular/ComicNeue_400Regular.ttf?url';
import comicNeueBold from '@expo-google-fonts/comic-neue/700Bold/ComicNeue_700Bold.ttf?url';

// Every font here has been checked to survive pdf-lib's subsetting intact and to lay out the
// same in the editor and in the PDF (`npm run check:fonts`; run it after adding one). Each has
// Hungarian ő/ű, a regular and a bold. Files load only when a text first uses them, and apart
// from the default (see vite.config.ts) they're kept for offline use only after that.

export type FontCategory = 'sans' | 'serif' | 'mono' | 'hand';

export interface FontFamilyInfo {
  /** The font's own name, shown as is in every language. */
  name: string;
  category: FontCategory;
  regular: string;
  bold: string;
  /** A common font this one has the same letter widths as, so text set in it fits the same space. */
  like?: string;
}

const families = {
  openSans: { name: 'Open Sans', category: 'sans', regular: openSansRegular, bold: openSansBold },
  arimo: { name: 'Arimo', category: 'sans', regular: arimoRegular, bold: arimoBold, like: 'Arial' },
  carlito: { name: 'Carlito', category: 'sans', regular: carlitoRegular, bold: carlitoBold, like: 'Calibri' },
  roboto: { name: 'Roboto', category: 'sans', regular: robotoRegular, bold: robotoBold },
  notoSans: { name: 'Noto Sans', category: 'sans', regular: notoSansRegular, bold: notoSansBold },
  inter: { name: 'Inter', category: 'sans', regular: interRegular, bold: interBold },
  sourceSans3: { name: 'Source Sans 3', category: 'sans', regular: sourceSans3Regular, bold: sourceSans3Bold },
  montserrat: { name: 'Montserrat', category: 'sans', regular: montserratRegular, bold: montserratBold },
  robotoCondensed: { name: 'Roboto Condensed', category: 'sans', regular: robotoCondensedRegular, bold: robotoCondensedBold },
  sourceSerif4: { name: 'Source Serif 4', category: 'serif', regular: sourceSerif4Regular, bold: sourceSerif4Bold },
  tinos: { name: 'Tinos', category: 'serif', regular: tinosRegular, bold: tinosBold, like: 'Times New Roman' },
  gelasio: { name: 'Gelasio', category: 'serif', regular: gelasioRegular, bold: gelasioBold, like: 'Georgia' },
  notoSerif: { name: 'Noto Serif', category: 'serif', regular: notoSerifRegular, bold: notoSerifBold },
  ptSerif: { name: 'PT Serif', category: 'serif', regular: ptSerifRegular, bold: ptSerifBold },
  lora: { name: 'Lora', category: 'serif', regular: loraRegular, bold: loraBold },
  ebGaramond: { name: 'EB Garamond', category: 'serif', regular: ebGaramondRegular, bold: ebGaramondBold },
  playfairDisplay: { name: 'Playfair Display', category: 'serif', regular: playfairDisplayRegular, bold: playfairDisplayBold },
  cousine: { name: 'Cousine', category: 'mono', regular: cousineRegular, bold: cousineBold, like: 'Courier New' },
  robotoMono: { name: 'Roboto Mono', category: 'mono', regular: robotoMonoRegular, bold: robotoMonoBold },
  sourceCodePro: { name: 'Source Code Pro', category: 'mono', regular: sourceCodeProRegular, bold: sourceCodeProBold },
  caveat: { name: 'Caveat', category: 'hand', regular: caveatRegular, bold: caveatBold },
  dancingScript: { name: 'Dancing Script', category: 'hand', regular: dancingScriptRegular, bold: dancingScriptBold },
  kalam: { name: 'Kalam', category: 'hand', regular: kalamRegular, bold: kalamBold },
  comicNeue: { name: 'Comic Neue', category: 'hand', regular: comicNeueRegular, bold: comicNeueBold },
} satisfies Record<string, FontFamilyInfo>;

export type FontFamily = keyof typeof families;

/** In the order the font menu lists them. */
export const FONT_FAMILIES: Record<FontFamily, FontFamilyInfo> = families;

export const DEFAULT_FONT_FAMILY: FontFamily = 'openSans';

export const FONT_CATEGORIES: FontCategory[] = ['sans', 'serif', 'mono', 'hand'];

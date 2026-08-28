/**
 * Dokumentum-munkamenet: a felület mögötti teljes logika.
 *
 * Egy megnyitott irat élettartamáig él. Ő tudja, mi van a fájlban, hol vannak a
 * találatok, mi lesz a cseréjük, és ő írja ki a kész fájlt. A felület csak
 * kérdez és parancsol — fájlt sosem lát.
 *
 * A MENTÉS SORRENDJE KÖTÖTT, ÉS EZ A FÁJL LEGFONTOSABB SZABÁLYA:
 *
 *   1. előállítjuk a kimeneti BÁJTOKAT (memóriában),
 *   2. ezekből a bájtokból VISSZAOLVASSUK a szöveget és a metaadatot,
 *   3. az ellenőrző kör EZEN fut,
 *   4. és csak ha tiszta, akkor keletkezik fájl a lemezen.
 *
 * Miért nem elég a memóriabeli „szándékszöveg”: az az, amit MI állítottunk elő.
 * Amit nem láttunk — Form XObject szövege, PDF-jegyzet, XMP-csomag, űrlapmező —,
 * az a szándékszövegben sincs benne, tehát ott az ellenőrzés definíció szerint
 * nem tud megbukni. A felületen megjelenő mondat („Visszaolvastuk a mentett
 * fájlt… egyetlen eredeti név sem maradt benne”) hitelesítésként olvasódik; ha
 * a saját szándékunkat igazolnánk vissza vele, az nem ellenőrzés, hanem
 * önigazolás. A kiírás pedig azért van a végén, mert a verify.ts fejléce
 * kimondja: amíg a jelentés nem tiszta, az exportot tiltjuk — egy lemezen
 * maradó, szivárgó fájl ennek pont az ellenkezője.
 *
 * A JEGYZŐKÖNYVBEN NINCS SZEREPLAP. A ki-kicsoda tábla ugyanaz az adat, amit a
 * kulcsfájl scrypt+AES-256-GCM-mel véd; kitalálható nevű, titkosítatlan
 * szövegfájlban, az anonimizált irat mellett tárolva értelmetlenné tenné az
 * egész munkát. A megfeleltetés KIZÁRÓLAG a titkosított kulcsfájlba kerül.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { HU_LETTER_CLASS } from '../hu/phonology.js';
import { SeedMatcher, type Match } from '../hu/matcher.js';
import { inflectName } from '../hu/inflect.js';
import type { SeedEntity, SeedPerson } from '../hu/names.js';
import {
  assignPseudonyms,
  buildContext,
  displayFor,
  fixDefiniteArticle,
  renderReplacement,
  type AnonEntity,
  type Assignment,
  type ReplacementContext,
  type SeedIdentifier,
  type Theme,
} from '../pseudonym.js';
import { verifyOutput } from '../verify.js';
import type { DocxAnalysis } from '../docx/anonymize.js';
import {
  deleteRanges,
  extractContent,
  groupRangesByStream,
  type ByteRange,
  type TextSegment,
} from '../pdf/textRuns.js';
import { readPageStreams } from '../pdf/resources.js';
import { bekezdesekre, ujratordel, type TordeltSor } from '../pdf/bekezdes.js';
import { formatPdfWarnings, type PageWarnings } from '../pdf/warnings.js';
import {
  buildPageText,
  segmentEditPlan,
  type Edit,
  type EditPlacement,
  type PageText,
} from '../pdf/pageText.js';
import {
  AZONOSITO_NEV,
  findAzonositok,
  resolveOverlaps,
  sortForCoverage,
  type AzonositoKind,
  type AzonositoMatch,
} from '../hu/azonositok.js';
import {
  findOsszegek,
  tervezOsszegCsere,
  type OsszegMatch,
  type OsszegMod,
  type Penznem,
} from '../hu/osszegek.js';
import { findDatumok, tervezDatumCsere } from '../hu/datumok.js';
// FUTTATHATÓ import: a találat kimenetét egyetlen helyen döntjük el, és
// ugyanezt a függvényt hívja a felület is (ui/src/panels.tsx).
import { AMOUNT_ENTITY_ID, DATE_ENTITY_ID, matchOutcome } from './types.js';
import type {
  AnalysisResult,
  AutoDecisionRow,
  CastRow,
  Disposition,
  DocumentInfo,
  EntityKind,
  ExportOptions,
  ExportResult,
  Highlight,
  MatchRow,
  ModelStatus,
  PageImage,
  PartyInput,
  ReplacementMode,
  TextSpan,
} from './types.js';

/** Magyar ékezeteket tartalmazó pótbetűkészletek, sorrendben. */
const FALLBACK_FONTS = [
  'C:/Windows/Fonts/times.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/calibri.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
];

const TITLE_PREFIX = /^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai|prof\.)\s*)+/i;

/** Ez kerül a kimenet /Producer és /Creator mezőjébe az eredeti helyett. */
const PRODUCER = 'Szivecske Anonimizáló';

/**
 * Rögzített időbélyeg a kimenet metaadatában.
 *
 * A készítés pillanata is azonosít: az eredeti /CreationDate összeköti a
 * kimenetet a forrásfájllal (és az irat megírásának napjával), a /ModDate pedig
 * megmondja, mikor anonimizáltunk. Egyik sem tartozik az irat olvasójára.
 */
const METADATA_EPOCH = new Date(Date.UTC(2000, 0, 1));

/**
 * A saját nevünk a kimenet metaadatában — az ellenőrző körnek meg kell tudnia
 * különböztetni a bennmaradt eredeti szövegtől, különben minden mentés után
 * saját magunkat jelentenénk gyanús maradványként.
 */
const OWN_SAFE_WORDS = ['Szivecske', 'Anonimizáló', 'Anonimizálási'];

/**
 * Az összeg- és dátumcserék gyűjtő-azonosítója.
 *
 * Ezek nem „felek”: nincs nevük, nincs eljárási szerepük, és nem a szereplapról
 * jönnek. A találati soroknak viszont kell azonosító, ezért kapnak egy-egy
 * közöset. A szereplapon szándékosan nem jelennek meg — ott a felek állnak.
 */
/**
 * A jegyzőkönyv fejlécsora. Azért állandó, mert a kiíráskor EBBŐL ismerjük fel,
 * hogy egy már meglévő fájl a saját korábbi jegyzőkönyvünk-e — idegen fájlt
 * nem írunk felül.
 */
const CERTIFICATE_HEADER = 'ANONIMIZÁLÁSI JEGYZŐKÖNYV';

/* Az összeg és a dátum álazonosítója a KÖZÖS típusokból jön (types.ts): a
   felület is ezekre hivatkozik, amikor külön színnel emeli ki őket. */

/** Egy keresési egység: PDF-nél egy oldal, DOCX-nél egy csomagrész. */
interface TextUnit {
  page: number;
  text: string;
  /** DOCX-nél a csomagrész neve (`word/document.xml`, `word/header1.xml`, …). */
  docxPart?: string;
  /** Emberi megnevezés a felületnek: „élőfej", „lábjegyzet", „megjegyzés". */
  docxLabel?: string;
  /** PDF-nél: a szakaszok és a lap adatai, hogy vissza tudjunk írni. */
  pdf?: {
    /**
     * A lap saját tartalomfolyamának azonosítója, LAPONKÉNT EGYEDI.
     *
     * A Form XObjectekből származó bájttartományok a saját folyamuk
     * hivatkozását hordozzák; ha a lapok gyökere mind ugyanazt a nevet kapná,
     * a második lap tartományai az első lap folyamára íródnának rá.
     */
    rootId: string;
    segments: TextSegment[];
    pageText: PageText;
    pageWidth: number;
    pageHeight: number;
  };
}

/**
 * A nyelvi modell állapota — a típus a `types.ts`-ben lakik, mert a felismerő
 * (`detect.ts`) tölti ki és a felület is látja. Itt csak továbbadjuk, hogy a
 * régi `import { ModelStatus } from './session.js'` alakú hívások ne törjenek.
 */
export type { ModelState, ModelStatus } from './types.js';

export interface AnalyzeInput {
  parties: PartyInput[];
  themeId: string;
  mode: ReplacementMode;
  caseSecret: string;
  /** Találatonkénti felhasználói döntések (találat-azonosító → döntés). */
  decisions?: Record<number, 'accept' | 'skip'>;
  /**
   * A MÁR KIOSZTOTT ÁLNEVEK — az ÜGY egészére, nem erre az iratra.
   *
   * MIÉRT A HÍVÓ ADJA. Az álnév nem az iraté, hanem az ügyé: ugyanaz a valódi
   * név az ügy minden iratában ugyanazt a fedőnevet viseli, és nem változhat
   * meg attól, hogy a felhasználó átbillent egy kapcsolót. Ha a munkamenet
   * NÉMÁN emlékezne a sajátjára, két irat két külön emlékezetet vezetne: az,
   * amelyiket előbb elemeztük egyedül, ragaszkodna a maga korábbi
   * kiosztásához, és a közös sorrend nem érne el hozzá — pontosan az a
   * széttartás állna vissza, ami ellen a közös sorrend van.
   *
   * Ezért az ügy szintjén tartja számon a főfolyamat, és minden iratnak
   * ugyanazt adja át. Üresen hagyva a kiosztás a szokott módon, a megjelenés
   * sorrendjéből dől el.
   */
  keep?: ReadonlyMap<string, Assignment>;
  /**
   * E fölött cserélünk automatikusan. Hiányában a motor beépített
   * alapértelmezése érvényes.
   */
  autoThreshold?: number;
  /**
   * A FELEK MEGJELENÉSI SORRENDJE — kívülről megadva, ha a hívó ismeri.
   *
   * A részletes indoklás a közös típusnál áll (`AnalyzeInput`, types.ts).
   * Röviden: több irat esetén EGYETLEN sorrendből kell dolgozni, különben
   * ugyanaz a valódi név iratonként más fedőnevet kapna.
   */
  appearanceOrder?: readonly string[];
  /**
   * A CÍMKÉK NYELVE a szerep-, adatfajta- és számozott módban. Alapból magyar.
   *
   * A fedőnév-módra nincs hatása: ott a névkészlet dönti el, milyen nyelvűek a
   * nevek, és a szállított készleteknek külön angol kiadásuk van.
   */
  labelLang?: 'hu' | 'en';
  /** Az összegek átírása. Alapból nem: szétveri a végösszegeket. */
  replaceAmounts?: boolean;
  /** A dátumok egységes eltolása ügyenként. */
  shiftDates?: boolean;
  /**
   * BEKEZDÉSENKÉNTI ÚJRATÖRDELÉS a kimeneti PDF-ben. Alapból igaz.
   *
   * A PDF-ben nincs bekezdés, csak sorok: mindegyik külön rajzolási utasítás.
   * Soronként újrarajzolva a csere két dolgot ront el — a sorkizárás elvész
   * (a mi sorunk normál szóközökkel áll, tehát csipkés a jobb széle), és egy
   * hosszabb álnév egyszerűen kifut a margóból, mert a szöveg nem tud a
   * következő sorba csordulni.
   *
   * Bekapcsolva a bekezdés EGÉSZ szövegét tördeljük újra a saját szélességére,
   * és a sorokat kizárjuk. Kikapcsolva a régi, soronkénti viselkedés marad —
   * kevesebbet nyúlunk a fájlhoz, cserébe a tördelés a csere helyén meglátszik.
   *
   * MIÉRT AZ ELEMZÉS BEMENETÉN. Így az előnézet és a mentés UGYANABBÓL az egy
   * értékből dolgozik. Két külön úton átadva a képernyő és a fájl elcsúszhatna
   * — és épp az előnézet ígérete volna oda, hogy amit látsz, az kerül a fájlba.
   */
  paragraphReflow?: boolean;
  /**
   * Fogadja el a program az ÁTNÉZÉSRE váró találatokat is, emberi döntés nélkül
   * („Csak csináld" mód; `Settings.autoMode`).
   *
   * A részletes indoklás a közös típusnál áll (`AnalyzeInput`, types.ts).
   * Röviden: a mérés szerint egy át nem nézett irat 35 bennmaradt nevet hagy,
   * ha csak az automatikus találatok cserélnek, és 1-et, ha az átnézésre
   * várókat is elfogadjuk — az ÓVATOSKODÁS okozza a szivárgás nagy részét.
   *
   * Az „elutasítva" fokozatot ez nem billenti át cserére: azok bizonyítottan
   * nem nevek („Fehér színű tehergépjármű"). A program viszont MEGMONDJA róluk
   * is, hogy ő döntött — az elutasított találat automatikus módban kifejezett
   * bent hagyás lesz, nem hallgatás. Enélkül az ellenőrző kör pontosan ezeken
   * bukna el, és automatikus módban egyetlen fájl sem keletkezne olyan iratból,
   * amiben köznévvel azonos alakú vezetéknév szerepel — márpedig a
   * leggyakoribb magyar vezetéknevek (Nagy, Szabó, Fehér) mind ilyenek.
   */
  acceptReview?: boolean;
  /**
   * Nevek, amiknek jogszerűen BENT KELL maradniuk: eljáró bíró, ügyvéd, a
   * bíróság neve (Bszi. 166. § (2)). Az ellenőrző kör ezt kapja meg — enélkül
   * a jogszerűen bent maradó nevek riasztásként jelennek meg, és a zaj miatt a
   * felhasználó a valódi találatokat is átugorja.
   */
  keepList?: string[];
  /** Szavak, amikről tudjuk, hogy nem személynevek (intézménynév, szakszó). */
  safeWords?: string[];
  /**
   * A nyelvi modell állapota a felismeréskor. Hiányában: KIKAPCSOLVA.
   *
   * A `detectParties` már kitölti a saját visszatérési értékében
   * (`DetectionResult.model`), tehát a hívónak nem kell összeraknia — csak
   * ÁTADNIA. Az `electron/main.ts` „doc:detectParties" kezelője a felismerés
   * eredményét adja a felületnek, a felület pedig a „doc:analyze" hívásban
   * küldi vissza; amíg ez a mező üresen érkezik, a jegyzőkönyv MINDIG azt
   * írja, hogy a modell ki van kapcsolva — akkor is, ha lefutott.
   */
  model?: ModelStatus;
}

/**
 * Az export eredménye a munkamenettől.
 *
 * Bővebb, mint az `ExportResult`: megmondja, hogy KELETKEZETT-E FÁJL. A
 * megkülönböztetés nem formaság — szivárgás esetén szándékosan nem írunk ki
 * semmit, és a felületnek nem szabad azt állítania, hogy „elkészült”.
 */
export interface SessionExportResult extends ExportResult {
  /** Igaz, ha a kimeneti fájl tényleg létrejött a lemezen. */
  written: boolean;
  /**
   * Itt KÖTELEZŐ, amit az `ExportResult` csak megenged. A közös típusban azért
   * opcionális a három, mert a felületi álkimenet is `ExportResult`-ot ad; a
   * motorból viszont sosem mehet ki nélkülük válasz.
   */
  certificatePath: string | null;
  warnings: string[];
  /** Amit a program EMBER HELYETT fogadott el; üres lista, ha nem volt ilyen. */
  autoAccepted: AutoDecisionRow[];
  /** A nyelvi modell állapota — ugyanaz, ami a jegyzőkönyvbe is bekerült. */
  model: ModelStatus;
}

/**
 * A PDF-kimenet egyetlen összeállításból: bájtok, panaszok, kiemelések.
 *
 * A HÁROM UGYANABBÓL A FUTÁSBÓL VALÓ, és ez a lényeg. A mentés a bájtokat
 * viszi el, az előnézet a bájtokat ÉS a kiemeléseket — ha a kettőt két külön
 * összeállítás adná, az előnézeten látott jelölés nem arról a fájlról szólna,
 * ami a mentéskor keletkezik.
 */
interface PdfBuildResult {
  bytes: Uint8Array;
  warnings: string[];
  /** A csereszövegek helye a KÉSZ lapokon, a lap méretének arányában. */
  highlights: Highlight[];
}

export class DocumentSession {
  readonly info: DocumentInfo;
  private readonly bytes: Uint8Array;
  private units: TextUnit[] = [];
  private pages: PageImage[] = [];
  private lastMatches: { row: MatchRow; match: Match; unit: number }[] = [];
  private lastAssignments = new Map<string, Assignment>();
  /** A program saját kiosztása, a kézi felülírások NÉLKÜL — lásd `assignments`. */
  private stickyAssignments = new Map<string, Assignment>();

  /**
   * AZ EBBEN AZ IRATBAN KIOSZTOTT ÁLNEVEK — a hívónak, az ügy nyilvántartásához.
   *
   * A főfolyamat ebből építi az ügy közös kiosztását, és a következő
   * elemzésnél `AnalyzeInput.keep`-ként adja vissza — így az álnév egyszer
   * dől el, és a ki-be kapcsolások nem írják át.
   *
   * A KÉZI FELÜLÍRÁSOK NINCSENEK BENNE, és ez szándékos: a kézzel beírt név a
   * felhasználó ELEVEN döntése, nem a program kiosztása. Ha ide kerülne, a
   * mező kiürítése némán hatástalan maradna — a megtartás visszatenné a
   * törölt nevet. A kézi név minden körben a felek listájáról kerül rá újra.
   */
  get assignments(): ReadonlyMap<string, Assignment> {
    return this.stickyAssignments;
  }
  private lastEntities: AnonEntity[] = [];
  /** A legutóbbi elemzés felei — a kihagyottak is, mert az ellenőrző körnek kellenek. */
  private lastParties: PartyInput[] = [];
  private lastCtx: ReplacementContext | null = null;
  private lastKeepList: string[] = [];
  private lastSafeWords: string[] = [];
  private lastModel: ModelStatus = { state: 'off' };
  /**
   * Amit a legutóbbi elemzésben a program EMBER HELYETT fogadott el.
   *
   * Azért marad meg az elemzés után is, mert a mentés eredményébe és a
   * jegyzőkönyvbe ugyanez a lista kerül. Ha a mentés újra összeállítaná, a
   * képernyő és a fájl idővel eltérne egymástól.
   */
  private lastAutoAccepted: AutoDecisionRow[] = [];
  /**
   * Bekezdésenként tördelünk-e a kimenetben. Az elemzés bemenetéről érkezik,
   * és a MENTÉS is ezt olvassa — így az előnézet és a fájl nem csúszhat szét.
   */
  private reflow = true;
  /** Az összeg- és dátumtervek figyelmeztetései — ezeket ki KELL írni. */
  private planWarnings: string[] = [];
  private docx: DocxAnalysis | null = null;
  private exportWarnings: string[] = [];
  /** A PDF-bejárás kihagyásai, emberi mondatokban. */
  private pdfWarnings: string[] = [];

  /** Feloldatlan változáskövetés: amíg van, a DOCX-export tilos. */
  get pendingRevisions(): number {
    return this.docx?.revisions.contentCount ?? 0;
  }

  /** A betöltéskor keletkezett figyelmeztetések (beágyazott objektum, ismeretlen rész…). */
  get loadWarnings(): string[] {
    // A betűkészlet-tábla, a téma és a webbeállítások sosem hordoznak
    // személyes adatot — ezekre figyelmeztetni csak zajt csinálna.
    const harmless = /word\/(theme\/theme\d*|webSettings|fontTable|settings|styles|numbering)\.xml/;
    return [
      // A PDF-oldali kihagyás ITT jut ki a felületre. A „nem találtam nevet" és
      // a „nem is láttam a szöveget" két gyökeresen más állítás; amíg a
      // ToUnicode nélküli betűkészletről szóló figyelmeztetés nem jött ki, a
      // program az elsőt mondta, miközben a második volt igaz.
      ...this.pdfWarnings,
      ...(this.docx?.warnings ?? []).filter((w) => !harmless.test(w)),
    ];
  }

  private constructor(path: string, bytes: Uint8Array, info: DocumentInfo) {
    this.bytes = bytes;
    this.info = info;
    void path;
  }

  static async open(path: string, homonyms: Set<string>): Promise<DocumentSession> {
    return DocumentSession.fromBytes(path, new Uint8Array(readFileSync(path)), homonyms);
  }

  /** Csak a tesztnek: a formátum-ellenőrzés önmagában is meghívható. */
  static formatCheck(bytes: Uint8Array, ext: string): string | null {
    return formatumGond(bytes, ext);
  }

  /**
   * Megnyitás memóriában lévő tartalomból. A változáskövetés feloldása után ezt
   * használjuk: az átalakított dokumentum így soha nem kerül ideiglenes fájlba.
   */
  static async fromBytes(path: string, bytes: Uint8Array, homonyms: Set<string>): Promise<DocumentSession> {
    const ext = extname(path).toLowerCase();
    // A kiterjesztés csak javaslat: a bájtok döntenek. Enélkül egy .doc vagy
    // .odt a szöveges ágra esne, a program értelmezhetetlen kacatot olvasna
    // UTF-8-ként, végigmenne a folyamaton nulla találattal, és a végén „tiszta"
    // minősítést adna — a felhasználó pedig anonimizáltnak hinné az iratot.
    const gond = formatumGond(bytes, ext);
    if (gond) throw new Error(gond);

    const format = ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'txt';

    const info: DocumentInfo = {
      path,
      fileName: basename(path),
      format,
      pageCount: 1,
      charCount: 0,
      looksScanned: false,
      pendingRevisions: 0,
      loadWarnings: [],
    };
    const session = new DocumentSession(path, bytes, info);
    void homonyms;

    if (format === 'pdf') await session.loadPdf();
    else await session.loadPlain(format);

    info.charCount = session.units.reduce((a, u) => a + u.text.length, 0);
    info.pageCount = session.units.length;
    info.looksScanned = format === 'pdf' && info.charCount < 40 * info.pageCount;
    info.pendingRevisions = session.pendingRevisions;
    info.loadWarnings = session.loadWarnings;
    return session;
  }

  // ─────────────────────────── betöltés ───────────────────────────

  /**
   * PDF: a lap SZÖVEGE nem csak a /Contents folyamban áll.
   *
   * A Do operátor egy másik objektum (Form XObject) tartalmát rajzolja a lapra:
   * fejléc, lábléc, bélyegző, aláírásblokk, iratsablon szinte mindig így kerül
   * oda. Amíg ide nem léptünk be, az ott lévő név el sem jutott a keresőig — és
   * mivel az ellenőrzés is a MI kiolvasott szövegünkön futott, semmi nem
   * jelezte a hiányt: a program tisztának mondta az iratot.
   */
  private async loadPdf(): Promise<void> {
    const doc = await PDFDocument.load(this.bytes);
    const pageWarnings: PageWarnings[] = [];
    const unreadable: string[] = [];

    for (let pi = 0; pi < doc.getPageCount(); pi++) {
      const page = doc.getPage(pi);
      const rootId = pdfRootId(pi);
      const streams = readPageStreams(page, rootId);
      const { segments, warnings } = extractContent(streams.root);
      const pageText = buildPageText(segments);
      const { width, height } = page.getSize();
      this.units.push({
        page: pi,
        text: pageText.text,
        pdf: { rootId, segments, pageText, pageWidth: width, pageHeight: height },
      });
      pageWarnings.push({ page: pi, warnings });
      for (const u of streams.unreadable) unreadable.push(`${pi + 1}. oldal: ${u}`);
    }

    this.pdfWarnings = formatPdfWarnings(pageWarnings);
    if (unreadable.length > 0) {
      this.pdfWarnings.push(
        `${unreadable.length} tartalomfolyamot nem tudtunk kicsomagolni (${unreadable
          .slice(0, 4)
          .join(', ')}). Az ezekben rajzolt szöveget NEM néztük át.`,
      );
    }
    this.pages = await renderPdfPages(this.bytes, doc.getPageCount(), this.units);
  }

  private async loadPlain(format: 'docx' | 'txt'): Promise<void> {
    if (format === 'txt') {
      this.units.push({ page: 0, text: Buffer.from(this.bytes).toString('utf8') });
      return;
    }
    await this.loadDocx();
  }

  /**
   * DOCX: minden csomagrész külön keresési egység lesz. Így az élőfejben, a
   * lábjegyzetben és a szövegdobozban lévő nevek is megvannak, és a
   * visszaíráskor pontosan tudjuk, melyik részbe melyik csere való.
   */
  private async loadDocx(): Promise<void> {
    const { analyzeDocx } = await import('../docx/anonymize.js');
    const analysis = await analyzeDocx(this.bytes);
    this.docx = analysis;

    analysis.parts.forEach((part, i) => {
      if (!part.text.trim()) return;
      this.units.push({
        page: i,
        text: part.text,
        docxPart: part.name,
        docxLabel: docxPartLabel(part.name, part.kind),
      });
    });
  }

  /**
   * Változáskövetés feloldása. A szöveg ettől MEGVÁLTOZIK, ezért a munkamenetet
   * újra kell építeni — a hívó a visszakapott bájtokkal nyit új munkamenetet.
   */
  async resolveRevisions(mode: 'accept' | 'reject'): Promise<Uint8Array> {
    const { resolveRevisions } = await import('../docx/anonymize.js');
    return resolveRevisions(this.bytes, mode);
  }

  // ─────────────────────────── elemzés ───────────────────────────

  analyze(input: AnalyzeInput, theme: Theme, homonyms: Set<string>): AnalysisResult {
    const setupWarnings: string[] = [];

    // Az azonosítók egységenként, EGYSZER kiszámolva. Kétszer kellenek: egyszer
    // ahhoz, hogy felként bekerüljenek a cserébe, egyszer pedig a lefedettségi
    // térkép feltöltéséhez — a kétszeri keresés ugyanazt adná, csak lassabban.
    const azonositokByUnit = this.units.map((u) => resolveOverlaps(findAzonositok(u.text)));

    // AZ IRATBAN MEGTALÁLT AZONOSÍTÓK IS FELEK.
    //
    // A `detectParties` külön listán adja vissza őket (`DetectionResult.identifiers`),
    // mert a felületen külön rovat való nekik. Ez a külön lista viszont eddig
    // sehol nem kelt át a feldolgozási láncon: a felismerő megtalálta az
    // e-mail-címet, a lakcímet, a TAJ-számot és a bankszámlaszámot, a csere
    // pedig soha nem látta őket, tehát VÁLTOZATLANUL bent maradtak a
    // kimenetben — miközben az ellenőrző kör tisztának minősítette az iratot,
    // hiszen ő is csak a felek listáját ismerte.
    //
    // Ezért a felvétel ITT, a motorban történik, és nem a felületen: így akkor
    // is működik, ha a hívó (a felület, egy teszt, egy parancssori futtató) nem
    // gondol rá. Amit a hívó KIFEJEZETTEN átadott, azt nem duplázzuk meg — az
    // ő döntése (kézi csereszöveg, kihagyás) erősebb.
    const parties = [...input.parties, ...foundIdentifierParties(azonositokByUnit, input.parties)];

    const entities = parties
      .filter((p) => !p.skipped)
      .map((p) => toEntity(p, setupWarnings))
      .filter((e): e is AnonEntity => e !== null);

    this.lastEntities = entities;
    this.lastParties = parties;
    this.lastKeepList = input.keepList ?? [];
    this.lastSafeWords = input.safeWords ?? [];
    this.lastModel = input.model ?? { state: 'off' };
    const byId = new Map(entities.map((e) => [e.id, e]));

    // A névkeresőnek CSAK a nevek valók: egy adószámon a ragozás, a becézés és
    // a monogramképzés értelmezhetetlen.
    //
    // A KERESÉS A KIOSZTÁS ELŐTT FUT, és ez a sorrend nem cserélhető fel: az
    // álnév kiosztásához tudni kell, ki jelenik meg előbb az iratban (lásd
    // `AssignOptions.appearanceOrder`), azt pedig csak a keresés mondja meg.
    // A kereső maga nem függ a kiosztástól — csak az entitásokat ismeri —,
    // tehát a megfordítás nem kerül semmibe.
    const matcher = new SeedMatcher(entities.filter(isNameEntity), {
      homonyms,
      ambiguousGivenNames: ambiguousGivenNames(entities),
      ...(input.autoThreshold === undefined ? {} : { autoThreshold: input.autoThreshold }),
    });

    // A névtalálatok EGYSZER, egységenként. Kétszer kellenek — a megjelenési
    // sorrendhez és magához a cseréhez —, de a keresés a leglassabb lépés az
    // egész elemzésben, ezért nem futtatjuk le kétszer ugyanarra a szövegre.
    const nameHitsByUnit = this.units.map((u) => matcher.find(u.text));

    const assignments = assignPseudonyms(entities, theme, {
      caseSecret: input.caseSecret,
      preferSimilarLength: true,
      /*
        A HÍVÓ SORRENDJE ERŐSEBB A SAJÁTNÁL.

        Egy irat esetén nincs különbség: a hívó nem ad semmit, mi a saját
        szövegünkből számolunk. Több irat esetén viszont a főfolyamat EGYETLEN
        sorrendet állapít meg az egész ügyre, és azt adja át mindegyik iratnak
        — enélkül ugyanaz a valódi név iratonként más fedőnevet kapna, és a
        kimenetek nem volnának együtt olvashatók.
      */
      appearanceOrder: input.appearanceOrder ?? appearanceOrder(nameHitsByUnit),
      /*
        A MÁR KIOSZTOTT ÁLNEVEK TOVÁBBÉLNEK — amit a hívó átad.

        Enélkül a kiosztás sorrendfüggő maradna: egyetlen új fél felvétele (a
        hivatalos szereplők bekapcsolása, egy kézzel felvett név, egy jobb
        gombos átértelmezés) átrendezte az EGÉSZ névsort, és a felperes, akit
        az ügyvéd már a fedőnevén ismert, más nevet kapott.

        A LISTÁT A HÍVÓ TARTJA, nem mi: az álnév az ÜGYÉ, nem ezé az egy
        iraté (lásd `AnalyzeInput.keep`). A készletváltás figyelése is az övé —
        ő tudja, mikor váltott a felhasználó.
      */
      ...(input.keep ? { keep: input.keep } : {}),
    });
    /*
      A MEGTARTANDÓ KIOSZTÁS PILLANATKÉPE — A KÉZI FELÜLÍRÁS ELŐTT.

      A kézi átírás (`applyManualReplacement`) HELYBEN módosítja a kiosztás
      sorát. Ha az ügy nyilvántartásába a módosított sor kerülne, a kézzel
      beírt név örökre rátapadna a félre: a felhasználó KIÜRÍTI a mezőt, a
      program visszateszi a megtartott — vagyis épp a törölt — nevet, és semmi
      nem árulja el, miért nem történt semmi. Ez a legdrágább fajta hiba
      ebben a programban: nem hibaüzenet, hanem néma tehetetlenség.

      Ezért a nyilvántartásba a PROGRAM saját kiosztása kerül, a kézi név
      nélkül. A kézi átírás minden körben újra rákerül, amíg a felhasználó
      kéri — és abban a pillanatban lekerül, amikor már nem.
    */
    this.stickyAssignments = new Map([...assignments].map(([id, a]) => [id, { ...a }]));

    // Kézi felülírás a felületről.
    for (const p of parties) {
      const a = assignments.get(p.id);
      if (a && p.manualReplacement && p.manualReplacement.trim()) {
        applyManualReplacement(a, p.manualReplacement.trim());
      }
    }
    this.lastAssignments = assignments;

    const ctx = buildContext(input.mode, entities, assignments, input.labelLang ?? 'hu');
    this.lastCtx = ctx;

    const identifierEntities = entities.filter(isIdentifierEntity);

    // Az összegek kerekítési rácsa az EGÉSZ iratra közös: ha oldalanként
    // terveznénk, ugyanaz az összeg két oldalon két különböző új értéket
    // kaphatna, és az ügyvéd, aki egymás mellé teszi a két oldalt, ezt azonnal
    // látja. Ezért előbb összeszedjük az összes összeget, és minden egységnél
    // átadjuk a TÖBBI egységét is.
    /*
      AZ ÖSSZEGEKET ÉS A DÁTUMOKAT AKKOR IS MEGKERESSÜK, HA NEM CSERÉLJÜK.

      Eddig a két kapcsoló a KERESÉST kapcsolta ki, tehát kikapcsolva a program
      azt sem tudta, hol vannak — a képernyőn semmi nem jelezte őket, és a
      felhasználó nem látta, mihez nem nyúlunk. Egy álnevesítő programban ez a
      rosszabbik irány: a bent maradó adatnak LÁTSZANIA kell.

      Innentől a keresés mindig lefut, és a kapcsoló azt dönti el, mi legyen a
      találatok ALAPÉRTELMEZETT döntése (`osztalyDontes`). Kikapcsolva minden
      összeg „bent marad" döntést kap — a felhasználó kapcsolójától, tehát nem
      eldöntetlen —, a kiemelés viszont ott áll az iraton, és egyetlen
      kattintással egyenként is bekapcsolható.
    */
    const amountsByUnit = this.units.map((u) => findOsszegek(u.text));
    const datesByUnit = this.units.map((u) => findDatumok(u.text));
    const amountMode: OsszegMod = input.mode === 'theme' ? 'aranyos' : 'cimke';
    /**
     * A találat fajtájára vonatkozó, EGÉSZ IRATRA szóló döntés — a kapcsolóé.
     *
     * `undefined`, ha a fajta be van kapcsolva: olyankor a felismerés fokozata
     * dönt, mint minden más találatnál.
     */
    const osztalyDontes = (entityId: string): 'skip' | undefined => {
      if (entityId === AMOUNT_ENTITY_ID) return input.replaceAmounts === true ? undefined : 'skip';
      if (entityId === DATE_ENTITY_ID) return input.shiftDates === true ? undefined : 'skip';
      return undefined;
    };

    const matches: MatchRow[] = [];
    const highlights: Highlight[] = [];
    /*
      AZ EGYSÉGEK KEZDŐPOZÍCIÓJA a `previewText`-ben.

      A felület szöveges nézete (DOCX, TXT — vagyis a jogi iratok többsége) az
      egybefűzött szöveget kapja meg, a találatok pozíciója viszont
      egységenként van nyilvántartva. Enélkül a nézet szövegkereséssel
      próbálná visszatalálni a találatokat, ami minden azonos alakú szót
      megjelölne — és a jelöléshez nem tartozna találat, tehát rá sem lehetne
      kattintani. Az elválasztó ugyanaz a két karakter, amivel a `previewText`
      is összefűz.
    */
    const unitStart: number[] = [];
    {
      let off = 0;
      for (const u of this.units) {
        unitStart.push(off);
        off += u.text.length + 2;
      }
    }
    const perEntity = new Map<string, { total: number; pending: number }>();
    const planWarnings = new Set<string>();
    // „Csak csináld" mód: a bizonytalan találatokat is a program dönti el.
    const acceptReview = input.acceptReview === true;
    const autoAccepted: AutoDecisionRow[] = [];
    let id = 0;
    this.lastMatches = [];

    this.units.forEach((unit, ui) => {
      /**
       * Lefedettségi térkép egységenként. Az elsőbbség a BEJEGYZÉS SORRENDJE:
       * ami előbb kerül be, az nyer. Ezért a sorrend nem ízlés kérdése.
       */
      const covered = new Array<boolean>(unit.text.length).fill(false);

      /**
       * A találatok GYŰJTVE, és csak a végén, POZÍCIÓ SZERINT rendezve kapnak
       * azonosítót.
       *
       * A bejegyzés sorrendje az elsőbbségről szól, a felületen viszont az
       * átnézés az iratot végigolvasva történik: ha az azonosítók a lista
       * elejére, a dátumok a végére kerülnének, a jogásznak oda-vissza kellene
       * ugrálnia a szövegben. A rendezés determinisztikus, ezért a találatok
       * azonosítói két elemzés között ugyanazok maradnak — a felületről érkező
       * `decisions` ezekre hivatkozik.
       */
      const collected: { m: Match; replacement: string | null }[] = [];
      const collect = (m: Match, replacement: string | null): void => {
        collected.push({ m, replacement });
      };

      const addRow = (m: Match, replacement: string | null): void => {
        const decided = decideFor(
          m.disposition,
          input.decisions?.[id],
          acceptReview,
          osztalyDontes(m.entityId),
        );
        const row: MatchRow = {
          id,
          entityId: m.entityId,
          surface: m.surface,
          replacement,
          reason: m.reason,
          confidence: m.confidence,
          disposition: m.disposition,
          ...(decided.decision === undefined ? {} : { decision: decided.decision }),
          ...(decided.byProgram ? { autoDecided: true } : {}),
          page: unit.page,
          context: contextAround(unit.text, m.start, m.end),
          previewStart: (unitStart[ui] ?? 0) + m.start,
          previewEnd: (unitStart[ui] ?? 0) + m.end,
        };
        matches.push(row);
        this.lastMatches.push({ row, match: m, unit: ui });

        // Amit a program EMBER HELYETT FOGADOTT EL. A bent hagyott elutasított
        // találat nem kerül ide: az látható marad az ellenőrző kör maradvány-
        // listáján, itt pedig elnyomná azt a néhány tételt, ami tényleg
        // megváltoztatta az iratot.
        if (decided.byProgram && decided.decision === 'accept') {
          autoAccepted.push({
            matchId: row.id,
            entityId: row.entityId,
            surface: row.surface,
            context: row.context,
            reason: row.reason,
            confidence: row.confidence,
            page: row.page,
            replacement: row.replacement,
            commonWord: isCommonWordMatch(m, byId.get(m.entityId), homonyms),
          });
        }

        const stat = perEntity.get(m.entityId) ?? { total: 0, pending: 0 };
        stat.total++;
        if (isUndecided(row)) stat.pending++;
        perEntity.set(m.entityId, stat);

        if (unit.pdf) {
          const rect = highlightFor(unit.pdf, m);
          if (rect) highlights.push({ matchId: id, page: unit.page, ...rect });
        }
        id++;
      };

      // 1. AZONOSÍTÓK — a NÉV- és HELYNÉV-találatok ELŐTT.
      //
      // A `sortForCoverage` a helynevet is tartalmazó fajtákat (helyrajzi szám,
      // teljes cím, irányítószám) teszi előre. Ha a „Szentendre" helynév
      // kerülne be előbb, a „Szentendre belterület 4127/8. hrsz." már ütközne
      // vele, és a hosszabb, valódi azonosító elveszne — pontosan a fontosabbik.
      for (const hit of sortForCoverage(azonositokByUnit[ui] ?? [])) {
        const entity = matchIdentifierEntity(hit, identifierEntities);
        if (!entity) continue;
        if (isCoveredRange(covered, hit.start, hit.end)) continue;
        markRange(covered, hit.start, hit.end);
        const m = identifierMatch(hit, entity.id);
        collect(m, renderReplacement(m, entity, ctx));
      }

      // 2. NEVEK — a fentebb egyszer már lefuttatott keresés eredményéből.
      for (const m of nameHitsByUnit[ui] ?? []) {
        if (isCoveredRange(covered, m.start, m.end)) continue;
        markRange(covered, m.start, m.end);
        const entity = byId.get(m.entityId);
        collect(m, entity ? renderReplacement(m, entity, ctx) : null);
      }

      // 3. ÖSSZEGEK — csak ha a felhasználó kérte.
      const unitAmounts = amountsByUnit[ui] ?? [];
      if (unitAmounts.length > 0) {
        const terv = tervezOsszegCsere(unitAmounts, {
          caseSecret: input.caseSecret,
          mod: amountMode,
          tovabbiErtekek: otherUnitAmounts(amountsByUnit, ui),
        });
        // A FIGYELMEZTETÉS CSAK BEKAPCSOLT CSERÉHEZ TARTOZIK. A terv kikapcsolva
        // is elkészül (kell a csereszöveg, hogy egyetlen összeg kattintással
        // bekapcsolható legyen), de a „a végösszeg nem jön ki" típusú
        // figyelmeztetés olyasmiről szólna, ami meg sem történik.
        if (input.replaceAmounts === true) for (const w of terv.figyelmeztetesek) planWarnings.add(w);
        for (const cs of terv.cserek) {
          const src = unitAmounts.find((a) => a.start <= cs.start && cs.end <= a.end);
          if (!src) continue;
          if (isCoveredRange(covered, cs.start, cs.end)) continue;
          markRange(covered, cs.start, cs.end);
          const m = plainMatch(AMOUNT_ENTITY_ID, cs.start, cs.end, unit.text, src.confidence, cs.indoklas, src.disposition);
          collect(m, cs.szoveg);
        }
      }

      // 4. DÁTUMOK — csak ha a felhasználó kérte.
      const unitDates = datesByUnit[ui] ?? [];
      if (unitDates.length > 0) {
        const terv = tervezDatumCsere(unitDates, { caseSecret: input.caseSecret, szoveg: unit.text });
        // Lásd az összegeknél: kikapcsolt eltolásról nincs mit figyelmeztetni.
        if (input.shiftDates === true) for (const w of terv.figyelmeztetesek) planWarnings.add(w);
        for (const cs of terv.cserek) {
          const src = unitDates.find((d) => d.start <= cs.start && cs.end <= d.end);
          if (!src) continue;
          if (isCoveredRange(covered, cs.start, cs.end)) continue;
          markRange(covered, cs.start, cs.end);
          const m = plainMatch(DATE_ENTITY_ID, cs.start, cs.end, unit.text, src.confidence, cs.indoklas, src.disposition);
          collect(m, cs.szoveg);
        }
      }

      collected.sort((a, b) => a.m.start - b.m.start || a.m.end - b.m.end);
      for (const { m, replacement } of collected) addRow(m, replacement);
    });

    this.planWarnings = [...planWarnings];
    this.lastAutoAccepted = autoAccepted;
    this.reflow = input.paragraphReflow !== false;

    const cast: CastRow[] = parties.map((p) => {
      const a = assignments.get(p.id);
      const entity = byId.get(p.id);
      const stat = perEntity.get(p.id) ?? { total: 0, pending: 0 };
      return {
        entityId: p.id,
        original: a?.original ?? p.fullName,
        // Amit a KIMENETI IRAT ténylegesen tartalmaz. Az `Assignment.display`
        // mindig a témás álnév — szerep-, adatfajta- és számozott módban
        // olyan párokat mutatott, amik az iratban sehol nem szerepeltek.
        replacement: p.skipped ? '(nem cseréljük)' : entity ? displayFor(entity, ctx) : '',
        kind: p.kind,
        role: p.role,
        gender: p.gender,
        occurrences: stat.total,
        pendingCount: stat.pending,
        manual: Boolean(p.manualReplacement?.trim()),
        skipped: Boolean(p.skipped),
      };
    });

    return {
      doc: this.info,
      pages: this.pages,
      textSpans: this.textSpans(),
      cast,
      matches,
      highlights,
      warnings: [
        ...modelWarnings(this.lastModel),
        ...setupWarnings,
        ...ctx.warnings,
        ...this.planWarnings,
        ...this.loadWarnings,
        ...this.exportWarnings,
      ],
      // A FOKOZATOK darabszáma, nem a döntéseké: azt mondja meg, mennyire volt
      // magabiztos a felismerés. Automatikus módban a döntés mind megszületik,
      // de az „átnéz" ettől még átnézésre váró találat volt — ha itt nullát
      // írnánk, épp az tűnne el, amiért az `autoAccepted` lista készül.
      counts: {
        auto: matches.filter((m) => m.disposition === 'auto').length,
        review: matches.filter((m) => m.disposition === 'review').length,
        reject: matches.filter((m) => m.disposition === 'reject').length,
      },
      // UGYANAZ A LISTA A KIMENET FELŐL. A `counts` a felismerés
      // magabiztosságát méri, ez azt, mi fog történni — a képernyőn a
      // jelmagyarázat, a kiemelés színe és az állapotsor mind ezt mondja.
      outcomes: {
        csere: matches.filter((m) => matchOutcome(m) === 'csere').length,
        bizonytalan: matches.filter((m) => matchOutcome(m) === 'bizonytalan').length,
        nincs: matches.filter((m) => matchOutcome(m) === 'nincs').length,
      },
      previewText: this.units.map((u) => u.text).join('\n\n'),
      autoAccepted,
    };
  }

  /** Az elfogadott találatokból képzett szerkesztések egységenként. */
  private editsByUnit(): Map<number, Edit[]> {
    const out = new Map<number, Edit[]>();
    for (const { row, match, unit } of this.lastMatches) {
      if (!isAccepted(row) || !row.replacement) continue;
      const list = out.get(unit) ?? [];
      // A `matchId` csak a megjelenítésé: az előnézet lapképén ebből tudja a
      // kiemelés, melyik találat áll alatta (szín, buboréksúgó).
      list.push({
        start: match.start,
        end: match.end,
        replacement: row.replacement,
        matchId: row.id,
      });
      out.set(unit, list);
    }
    return out;
  }

  /** A dokumentum teljes szövege — a felek automatikus felismeréséhez. */
  fullText(): string {
    return this.units.map((u) => u.text).join('\n\n');
  }

  /**
   * A KIJELÖLHETŐ SZÖVEGRÉTEG a lapképekhez — csak PDF-en.
   *
   * Ugyanabból a bejárásból, amiből a kiemelés helye (`highlightFor`): a
   * szakasz alapvonala, a betűmérete és a ténylegesen kirajzolt szélessége már
   * megvan, ez csak arányokra váltja őket. Két külön geometria a képen látható
   * szó és a fölé fektetett szöveg közé lassan éket verne — a kijelölés
   * elcsúszna a betűkről, és a felhasználó mást jelölne ki, mint amit lát.
   *
   * Üres lista lapkép nélkül: a réteg megjelenítése a lapképhez kötött, és
   * nélküle csak a memóriát terhelné.
   */
  private textSpans(): TextSpan[] {
    if (this.pages.length === 0) return [];
    const out: TextSpan[] = [];
    for (const unit of this.units) {
      const pdf = unit.pdf;
      if (!pdf) continue;
      for (const span of pdf.pageText.spans) {
        const seg = span.segment;
        if (seg.text.trim().length === 0 || seg.width <= 0 || seg.fontSize <= 0) continue;
        // UGYANAZ A KÉT ARÁNYSZÁM, mint a `highlightFor`-ban: a betűtest az
        // alapvonal fölött és alatt. Külön számokból a kijelölés és a
        // kiemelés más magasan ülne ugyanazon a szón.
        const ascent = seg.fontSize * 0.82;
        const descent = seg.fontSize * 0.24;
        out.push({
          page: unit.page,
          left: seg.x / pdf.pageWidth,
          top: (pdf.pageHeight - (seg.y + ascent)) / pdf.pageHeight,
          width: seg.width / pdf.pageWidth,
          height: (ascent + descent) / pdf.pageHeight,
          fontSize: seg.fontSize / pdf.pageWidth,
          text: seg.text,
        });
      }
    }
    return out;
  }

  /** Az anonimizált szöveg (előnézethez és a szöveges kimenethez). */
  anonymizedText(): string {
    const edits = this.editsByUnit();
    return this.units
      .map((unit, ui) => applyEdits(unit.text, edits.get(ui) ?? []))
      .join('\n\n');
  }

  // ─────────────────────────── mentés ───────────────────────────

  /**
   * A kimenet előállítása, ELLENŐRZÉSE, és — csak ha tiszta — kiírása.
   *
   * A sorrend kötött (lásd a fájl fejlécét). Szivárgás esetén EGYETLEN fájl sem
   * keletkezik: sem az irat, sem a kulcsfájl, sem a jegyzőkönyv. A jelentés
   * viszont visszamegy a felületre, hogy a felhasználó lássa, mit kell még
   * eldöntenie.
   */
  async export(opts: ExportOptions): Promise<SessionExportResult> {
    const edits = this.editsByUnit();
    let replaced = 0;
    for (const list of edits.values()) replaced += list.length;
    // ELDÖNTETLEN = amiről SENKI nem döntött. Nem ugyanaz, mint a „nem
    // cserélődik le": a kihagyás is döntés, akár a felhasználó mondta ki, akár
    // a program automatikus módban. Amíg ez a szám a le nem cserélt találatokat
    // számolta, a jegyzőkönyv „Eldöntetlen találat: 1" sort írt olyan iratra
    // is, amit a felhasználó végigdöntött — automatikus módban pedig épp azt
    // állította volna, hogy maradt eldöntendő, miközben a mód lényege, hogy
    // nincs.
    const pending = this.lastMatches.filter(({ row }) => isUndecided(row)).length;

    // 1. A kimeneti bájtok — még semmi nem megy lemezre.
    let outputBytes: Uint8Array;
    if (this.info.format === 'pdf') {
      const result = await this.exportPdf(edits);
      outputBytes = result.bytes;
      this.exportWarnings = result.warnings;
    } else if (this.info.format === 'docx') {
      const result = await this.exportDocx(edits);
      outputBytes = result.bytes;
      this.exportWarnings = result.warnings;
    } else {
      outputBytes = Buffer.from(this.anonymizedText(), 'utf8');
      this.exportWarnings = [];
    }

    // 2. A KÉSZ BÁJTOK visszaolvasása: ezen fut az ellenőrzés, nem a
    //    szándékszövegen.
    const readback = await this.readBack(outputBytes);

    // A megtartandó nevek két forrásból jönnek: akiket a felhasználó KIVETT a
    // cseréből, és akiket a törvény hagyat bent (eljáró bíró, ügyvéd, a
    // bíróság neve — Bszi. 166. § (2)). Enélkül a saját döntése és a
    // jogszabály riasztásként jött vissza, és a zajban a valódi találat vész el.
    const keepList = [
      ...this.lastParties.filter((p) => p.skipped).map((p) => p.fullName),
      ...this.lastKeepList,
    ];

    // Amit tételesen KIHAGYTUNK a cseréből: ezek jogosan maradnak a szövegben.
    // Csak a KIFEJEZETT 'skip' számít — az el nem döntött találat továbbra is
    // kemény szivárgás, mert a hallgatás nem jóváhagyás. Ugyanez a
    // megkülönböztetés áll a DOCX bájtszintű tiltólistája mögött is.
    //
    // Automatikus módban a döntést a PROGRAM mondja ki az elutasított
    // találatokra (`decideFor`), és ez nem kiskapu: az elutasítás bizonyítékon
    // áll („Fehér színű tehergépjármű" — köznév, mondat elején, kisbetűs szó
    // követi), a tétel pedig nem tűnik el, hanem a maradványlistára kerül,
    // tehát látható marad. Enélkül automatikus módban a mérésben szereplő
    // három iratból az ítéletről EGYETLEN fájl sem keletkezne — nem azért,
    // mert bent maradt egy név, hanem mert egy teherautó fehér.
    const reviewedKept = this.lastMatches
      .filter(({ row }) => row.decision === 'skip')
      .map(({ row }) => ({ entityId: row.entityId, surface: row.surface }));

    const report = verifyOutput(readback.text, this.lastEntities.filter(isNameEntity), {
      pseudonyms: this.outputPseudonyms(),
      keepList,
      safeWords: [...this.lastSafeWords, ...OWN_SAFE_WORDS],
      // Az irat EREDETI azonosítói: ezek találata biztos szivárgás, nem gyanú.
      // A tagolás nem számít, a verify.ts a karaktereket köti, az elválasztót nem.
      numericLiterals: this.lastEntities.filter(isIdentifierEntity).map((e) => e.name),
      // A tételesen bent hagyott alakok a SZÁMFORMÁTUMÚ körből is kikerülnek.
      // A `reviewedKept` csak a névkeresésre hat; enélkül egy szándékosan bent
      // hagyott ügyszám vagy irányítószám örökre exportálhatatlanná tenné az
      // iratot — a felhasználó saját döntése zárná ki a mentést.
      keepNumbers: reviewedKept.map((k) => k.surface),
      reviewedKept,
    });

    // A bájtszintű maradvány ugyanolyan szivárgás, mint a szövegbeli — csak ott
    // van, ahová a szövegkinyerőnk nem lát el (bináris OLE-tároló, ismeretlen
    // rész). A kettőt együtt jelentjük.
    const leaks = [
      ...report.leaks.map((l) => ({ surface: l.surface, detail: l.detail })),
      ...readback.byteLeaks,
      ...this.textIdentifierLeaks(readback.text, report.leaks, reviewedKept),
    ];
    const ok = leaks.length === 0;

    // 3. Kiírás — CSAK tiszta jelentés után.
    let keyPath: string | null = null;
    let certificatePath: string | null = null;
    const certificate = this.certificate(opts, replaced, pending, leaks.length, report.residualTotal, report.checkedChars);

    if (ok) {
      // A kulcsfájl MEGY ELŐSZÖR. A `writeKeyFile` ellenőrzi a jelszót, és
      // gyenge vagy hiányzó jelszónál kivételt dob — ha utána írnánk, az
      // álnevesített irat már a lemezen feküdne, a visszafejtő tábla viszont
      // sehol. Egy fölöslegesen ottmaradt, titkosított kulcsfájl önmagában
      // használhatatlan; egy kulcs nélkül maradt álnevesített irat viszont
      // visszafordíthatatlan, pedig a felhasználó épp az ellenkezőjét kérte.
      if (opts.keepKey) {
        const { writeKeyFile } = await import('./keyfile.js');
        keyPath = await writeKeyFile(opts.outputPath, this.lastAssignments, opts.keyPassphrase ?? '');
      }
      writeFileSync(opts.outputPath, outputBytes);
      certificatePath = this.writeCertificate(opts.outputPath, certificate);
    }

    return {
      outputPath: opts.outputPath,
      written: ok,
      keyPath,
      certificatePath,
      model: this.lastModel,
      // UGYANAZ a lista, ami a jegyzőkönyv FIGYELMEZTETÉSEK rovatába került.
      // Egy részük csak MOST keletkezett (a PDF-metaadat kitakarítása, a
      // vissza nem írható tartalomfolyam, a beágyazott objektum), tehát az
      // elemzés eredményében még nem szerepelhetett — a felhasználó pedig csak
      // akkor látta volna őket, ha a mentés után újra lefuttat mindent.
      warnings: this.exportWarningList(),
      // Amit a program EMBER HELYETT fogadott el. Automatikus módban a
      // felhasználó ezt a képernyőt látja először — ha a lista csak az
      // elemzésnél volna meg, a „kész van" pillanatban semmi nem mondaná meg,
      // hol döntött helyette a program.
      autoAccepted: this.lastAutoAccepted,
      report: {
        ok,
        leaks,
        // A verify.ts MÁR levágta a listát; itt nem vágunk másodszor, mert a
        // két egymásra rakott korlát közül a felület csak a kisebbiket látná.
        residual: report.residual.map((l) => ({ surface: l.surface, detail: l.detail })),
        residualTotal: report.residualTotal,
        replaced,
        pending,
        checkedChars: report.checkedChars,
      },
      certificate,
    };
  }

  /**
   * Bent maradt SZÖVEGES azonosítók, amikre a számformátumú kör nem lát rá.
   *
   * A `verify.ts` azonosító-mintái számokra készültek: a konkrét azonosító
   * karakterei közé csak szóközt, pontot, kötőjelet és perjelet engednek. A
   * teljes lakcímben viszont VESSZŐ áll („2000 Szentendre, Dózsa György út
   * 2."), az e-mail-címben pedig kukac — ezekre a minta soha nem illeszkedik.
   * Egy eldöntetlenül bent maradt lakcím vagy e-mail-cím tehát ott nem bukott
   * el, és az irat „tiszta" minősítést kapott azzal együtt, hogy a felperes
   * lakcíme szó szerint benne maradt.
   *
   * A számformátumú körrel nem duplázunk: amit az már jelentett, azt itt
   * kihagyjuk (tagolástól független kulcs szerint). Amit a felhasználó
   * kifejezetten bent hagyott, az itt sem szivárgás — a hallgatás viszont
   * továbbra sem jóváhagyás, tehát az EL NEM DÖNTÖTT találat elbukik.
   */
  private textIdentifierLeaks(
    output: string,
    reported: readonly { surface: string }[],
    reviewedKept: readonly { surface: string }[],
  ): { surface: string; detail: string }[] {
    const skip = new Set<string>();
    for (const l of reported) skip.add(residueKey(l.surface));
    for (const k of reviewedKept) skip.add(residueKey(k.surface));

    const out: { surface: string; detail: string }[] = [];
    for (const e of this.lastEntities.filter(isIdentifierEntity)) {
      const key = residueKey(e.name);
      if (key.length < MIN_IDENTIFIER_RESIDUE || skip.has(key)) continue;
      const hits = countLiteral(output, e.name);
      for (let i = 0; i < hits; i++) {
        out.push({
          surface: e.name,
          detail: `az irat eredeti azonosítója megmaradt a kimenetben (${AZONOSITO_NEV[e.identifierKind]})`,
        });
      }
    }
    return out;
  }

  /**
   * Az álnevek úgy, AHOGY A KIMENETI IRATBAN SZEREPELNEK.
   *
   * Nem elég az `Assignment.display`: az mindig a témás álnév, szerep-,
   * adatfajta- és számozott módban viszont más szöveg került az iratba
   * („[I. r. alperes]", „[NÉV-2]"). Ha csak a témás alakot adnánk át, a söprő
   * ellenőrzés a saját cseréinket jelentené gyanús maradványként. A `display`
   * azért marad benne, mert a kulcsfájl és a szereplap azt rögzíti.
   */
  private outputPseudonyms(): string[] {
    const out = new Set<string>();
    for (const a of this.lastAssignments.values()) out.add(a.display);
    const ctx = this.lastCtx;
    if (ctx) for (const e of this.lastEntities) out.add(displayFor(e, ctx));
    return [...out];
  }

  /**
   * A KÉSZ BÁJTOK visszaolvasása ellenőrzésre.
   *
   * Nem a memóriabeli szándékszöveg: azt mi állítottuk elő, és pontosan azokat
   * a helyeket tartalmazza, ahol cseréltünk — vagyis saját magát igazolná
   * vissza. A visszaolvasott szöveg mellé a METAADAT is bekerül, mert a
   * felületen elhangzó ígéret („sem a szövegben, sem a metaadatban”) csak így
   * ellenőrizhető állítás.
   */
  private async readBack(bytes: Uint8Array): Promise<{ text: string; byteLeaks: { surface: string; detail: string }[] }> {
    if (this.info.format === 'pdf') {
      const doc = await PDFDocument.load(bytes);
      const parts: string[] = [];
      for (let pi = 0; pi < doc.getPageCount(); pi++) {
        const streams = readPageStreams(doc.getPage(pi), pdfRootId(pi));
        parts.push(buildPageText(extractContent(streams.root).segments).text);
      }
      parts.push(...collectPdfStrings(doc));
      return { text: parts.join('\n\n'), byteLeaks: [] };
    }

    if (this.info.format === 'docx') {
      const { analyzeDocx } = await import('../docx/anonymize.js');
      const analysis = await analyzeDocx(bytes);
      const text = analysis.parts.map((p) => p.text).join('\n\n');
      return { text, byteLeaks: await this.docxByteLeaks(bytes, analysis) };
    }

    return { text: Buffer.from(bytes).toString('utf8'), byteLeaks: [] };
  }

  /**
   * Bájtszintű maradvány a DOCX-csomag NEM SZÖVEGHORDOZÓ részeiben.
   *
   * A szöveges részeket a fenti kör már ellenőrizte — ott a felhasználó
   * tudatosan bent hagyott alakjait is helyesen kezeljük. Ez a kör azokat a
   * helyeket nézi meg, ahová a szövegkinyerőnk nem lát el: bináris OLE-tároló,
   * ismeretlen rész, régi UTF-16LE tartalom. Ott az eredeti név megjelenése nem
   * lehet emberi döntés eredménye — ott csak szivárgás lehet.
   */
  private async docxByteLeaks(
    bytes: Uint8Array,
    analysis: DocxAnalysis,
  ): Promise<{ surface: string; detail: string }[]> {
    const needles = this.residueNeedles();
    if (needles.length === 0) return [];

    const { ZipArchive } = await import('../docx/zip.js');
    const { findResidue } = await import('../docx/sanitize.js');
    const verified = new Set(analysis.parts.map((p) => p.name));

    const out: { surface: string; detail: string }[] = [];
    const seen = new Set<string>();
    for (const hit of findResidue(ZipArchive.open(bytes), needles)) {
      if (verified.has(hit.part)) continue;
      const key = `${hit.part}|${hit.needle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        surface: hit.needle,
        detail:
          `az eredeti név a csomag ${hit.part} részében maradt meg (${hit.encoding}, ` +
          `${hit.offset}. bájt) — ezt a részt a szövegkinyerés nem látja`,
      });
    }
    return out;
  }

  /**
   * Mire keresünk rá a nyers bájtokban.
   *
   * Csak TELJES nevekre és azonosítókra: egy három-négy betűs alak („Kis")
   * bináris tartalomban véletlenül is előfordul, és a hamis riasztás
   * megakadályozná a mentést. A hosszú alak viszont nem véletlen.
   */
  private residueNeedles(): string[] {
    const keep = new Set(this.lastKeepList.map((k) => k.toLowerCase()));
    const out = new Set<string>();
    for (const a of this.lastAssignments.values()) {
      const original = a.original.trim();
      if (original.length < MIN_BYTE_NEEDLE) continue;
      if (keep.has(original.toLowerCase())) continue;
      out.add(original);
    }
    return [...out];
  }

  /**
   * DOCX visszaírás formátumhűen.
   *
   * A `forbidden` lista a biztonsági öv: az írás UTÁN a motor visszaolvassa a
   * kész csomag minden részének nyers bájtjait, és ha bármelyik eredeti név
   * megmaradt, hibát dob a mentés helyett. Így nem fordulhat elő, hogy egy
   * szövegdoboz rejtett ágában bennmarad a név.
   */
  private async exportDocx(editsByUnit: Map<number, Edit[]>): Promise<{ bytes: Uint8Array; warnings: string[] }> {
    const { writeDocxDetailed } = await import('../docx/anonymize.js');

    const byPart = new Map<string, Edit[]>();
    this.units.forEach((unit, ui) => {
      const edits = editsByUnit.get(ui) ?? [];
      if (!unit.docxPart || edits.length === 0) return;
      byPart.set(unit.docxPart, [...(byPart.get(unit.docxPart) ?? []), ...edits]);
    });

    // Szigorú tiltólista CSAK akkor, ha a felhasználó minden találatot eldöntött.
    //
    // Ha valamit szándékosan bent hagyott, akkor a szövege jogosan marad a
    // fájlban — sőt egy bent hagyott hosszabb alak (pl. „Kovács Jánosné")
    // tartalmazhat egy lecserélt rövidebbet is („Kovács János"). Ilyenkor a
    // nyers bájtos tiltás hamis riasztást adna, és megakadályozná a mentést.
    // Ezért a kemény kapu a végigvitt átnézéshez tartozik; a köztes állapotot
    // az ellenőrző kör jelentése mutatja meg.
    const pendingMatches = this.lastMatches.filter(({ row }) => !isAccepted(row));
    const forbidden: string[] = [];
    if (pendingMatches.length === 0) {
      const surfaces = new Set<string>();
      for (const { row } of this.lastMatches) surfaces.add(row.surface);
      forbidden.push(...surfaces);
    }

    const result = await writeDocxDetailed(this.bytes, byPart, { forbidden });
    return { bytes: result.bytes, warnings: result.warnings };
  }

  /**
   * PDF visszaírás: a betűket ténylegesen TÖRÖLJÜK a fájlból.
   *
   * A törlendő bájttartományok folyamonként érvényesek — egy Form XObjectből
   * származó tartomány a lap folyamára írva egy tetszőleges utasítást vágna ki,
   * a név pedig a helyén maradna. Ezért a `groupRangesByStream` szerinti
   * csoportosítás nem kényelmi lépés, hanem a helyesség feltétele.
   */
  private async exportPdf(editsByUnit: Map<number, Edit[]>): Promise<PdfBuildResult> {
    const doc = await PDFDocument.load(this.bytes);
    doc.registerFontkit(fontkit);
    const fontPath = FALLBACK_FONTS.find((f) => {
      try {
        readFileSync(f);
        return true;
      } catch {
        return false;
      }
    });
    if (!fontPath) throw new Error('Nem találtam ékezetes betűkészletet a rendszerben.');
    const embedded = await doc.embedFont(readFileSync(fontPath), { subset: true });

    const warnings: string[] = [];
    const highlights: Highlight[] = [];
    const redraws: { page: number; x: number; y: number; size: number; text: string }[] = [];

    this.units.forEach((unit, ui) => {
      const pdf = unit.pdf;
      if (!pdf) return;
      const edits = editsByUnit.get(ui) ?? [];
      if (edits.length === 0) return;

      const page = doc.getPage(unit.page);
      const streams = readPageStreams(page, pdf.rootId);

      // A szakaszok ÚJ szövege és a csereszövegek helye — egyszer, előre.
      const tervek = pdf.pageText.spans.map((span) => ({
        span,
        ...segmentEditPlan(span, edits),
      }));
      const tervSzakaszSzerint = new Map(tervek.map((t) => [t.span.segment, t]));

      const toDelete: ByteRange[] = [];
      /** Amit a bekezdéses út már elintézett — a soronkénti ág átugorja. */
      const elintezett = new Set<TextSegment>();

      /*
        ELŐBB A BEKEZDÉSEK, HA KÉRTÉK.

        A bekezdés EGÉSZ szövegét tördeljük újra a saját szélességére, és a
        sorokat kizárjuk — így a jobb margó megmarad, és a hosszabb álnév a
        következő sorba csordul ahelyett, hogy kifutna a lapról. Amelyik
        bekezdésre ez nem megy (nem férne el a saját soraiban), az érintetlenül
        átesik a soronkénti ágra: egy alsó szomszédjára csúszott bekezdés
        rosszabb a csipkés jobb szélnél.
      */
      if (this.reflow) {
        for (const b of bekezdesekre(pdf.pageText.spans.map((sp) => sp.segment))) {
          const sajatTervek = b.sorok.map((sor) => tervSzakaszSzerint.get(sor)).filter((t) => t !== undefined);
          if (sajatTervek.length !== b.sorok.length) continue;
          if (sajatTervek.every((t) => t.text === t.span.segment.text)) continue;

          // A bekezdés új szövege — ugyanúgy szóközzel fűzve, ahogy az
          // oldalszintű szöveg is épül (`buildPageText`).
          const eltolasok: number[] = [];
          let bekezdesSzoveg = '';
          for (const t of sajatTervek) {
            if (bekezdesSzoveg.length > 0) bekezdesSzoveg += ' ';
            eltolasok.push(bekezdesSzoveg.length);
            bekezdesSzoveg += t.text;
          }

          const meret = b.sorok[0]!.fontSize;
          const tordelt = ujratordel(b, tisztitottBekezdes(bekezdesSzoveg), (t) =>
            merSzelesseg(embedded, t, meret),
          );
          if (tordelt === null) continue;

          for (const sor of b.sorok) {
            toDelete.push(...sor.opRanges);
            elintezett.add(sor);
          }
          for (const sor of tordelt) {
            for (const szo of sor.szavak) {
              redraws.push({ page: unit.page, x: szo.x, y: sor.y, size: meret, text: szo.szoveg });
            }
          }
          // A kiemelés a KÉSZ tördelésben: a csereszöveg másik sorba is kerülhet,
          // mint ahol az eredeti állt.
          sajatTervek.forEach((t, i) => {
            for (const hely of t.placements) {
              if (hely.edit.matchId === undefined) continue;
              const kezd = eltolasok[i]! + hely.start;
              const veg = eltolasok[i]! + hely.end;
              for (const box of tordeltKiemelesek(tordelt, kezd, veg, meret, pdf)) {
                highlights.push({ matchId: hely.edit.matchId, page: unit.page, ...box });
              }
            }
          });
        }
      }

      for (const { span, text: newText, placements } of tervek) {
        if (elintezett.has(span.segment)) continue;
        if (newText === span.segment.text) continue;
        toDelete.push(...span.segment.opRanges);
        redraws.push({
          page: unit.page,
          x: span.segment.x,
          y: span.segment.y,
          size: span.segment.fontSize,
          text: newText,
        });
        /*
          A KIEMELÉS A KÉSZ SORBAN MÉRVE — nem az eredetiben.

          Az álnév ritkán ugyanolyan hosszú, mint a valódi név, és a sort
          amúgy is a MI betűkészletünkkel rajzoljuk újra. Az eredeti
          koordinátákból számolt téglalap ezért fokozatosan elcsúszna a sor
          mentén: a második csere már a szomszéd szót karikázná be. A
          szélességet ugyanazzal a betűvel és mérettel mérjük, amivel
          rajzolunk — így a jelölés pontosan azon a szón ül, ami a lapon áll.
        */
        for (const p of placements) {
          if (p.edit.matchId === undefined) continue;
          const box = redrawHighlight(embedded, span.segment, newText, p, pdf);
          if (box) highlights.push({ matchId: p.edit.matchId, page: unit.page, ...box });
        }
      }
      if (toDelete.length === 0) return;

      for (const [streamId, ranges] of groupRangesByStream(toDelete)) {
        const content = streams.content(streamId);
        if (!content) {
          warnings.push(
            `A(z) ${unit.page + 1}. oldal ${streamId} tartalomfolyamát nem sikerült ` +
              'visszaolvasni, ezért az abban lévő szöveget NEM töröltük ki.',
          );
          continue;
        }
        if (!streams.write(streamId, deleteRanges(content, ranges, streamId))) {
          warnings.push(
            `A(z) ${unit.page + 1}. oldal ${streamId} tartalomfolyamát nem sikerült visszaírni, ` +
              'ezért az abban lévő szöveget NEM töröltük ki.',
          );
        }
      }
    });

    // A kirajzolás a törlés UTÁN: a pdf-lib új tartalomfolyamot fűz a laphoz,
    // a törlés viszont a meglévőt cseréli le.
    for (const r of redraws) {
      doc.getPage(r.page).drawText(r.text, {
        x: r.x,
        y: r.y,
        size: r.size,
        font: embedded,
        color: rgb(0, 0, 0),
      });
    }

    warnings.push(...scrubPdfMetadata(doc));

    // Teljes újraírás, soha nem növekményes mentés — különben a régi tartalom
    // ott marad a fájlban és visszafejthető.
    const bytes = await doc.save({ useObjectStreams: false });
    return { bytes, warnings, highlights };
  }

  /**
   * AZ ÁLNEVESÍTETT IRAT LAPKÉPEI — a valódi kimenet kirajzolva.
   *
   * Ez az előnézet PDF-en. Nem a szöveg egy másik szedése: pontosan azokat a
   * bájtokat rajzoljuk ki, amelyek a mentéskor a fájlba kerülnének (ugyanaz az
   * `exportPdf`, ugyanaz a betűtörlés, ugyanaz az újrarajzolás). Előtte az
   * előnézet a lapról LESZEDETT szöveget mutatta egyetlen folyó bekezdésben —
   * abban se sortörés nem volt, se hasáb, se táblázat, se fejléc a helyén, és
   * a felhasználó a mentés pillanatáig nem látta, milyen lesz az irat.
   *
   * A tördelésen túl ez azt is megmutatja, amit CSAK a kész fájl tud: hogy az
   * álnév kifut-e a sorból, és hogy a visszaírt sor betűje elüt-e az eredetitől.
   * Ezekre eddig semmi nem figyelmeztetett.
   *
   * SEMMI NEM MEGY LEMEZRE. A bájtok a memóriában készülnek és ott is
   * maradnak; a mentés külön út (`export`), a saját ellenőrző körével.
   *
   * Nem PDF-en üres listát ad — DOCX-hez és TXT-hez nincs lapképünk, ott az
   * előnézet marad a szöveg.
   */
  async anonymizedPages(): Promise<{ pages: PageImage[]; highlights: Highlight[] }> {
    if (this.info.format !== 'pdf') return { pages: [], highlights: [] };
    const built = await this.exportPdf(this.editsByUnit());
    const pages = await renderPdfPages(built.bytes, this.units.length, this.units);
    // Lapkép nélkül a kiemelésnek sincs mire ülnie: a felület ilyenkor a
    // szöveges előnézetre esik vissza, és ott a saját jelöléseit használja.
    return pages.length === 0 ? { pages: [], highlights: [] } : { pages, highlights: built.highlights };
  }

  /**
   * A jegyzőkönyv kiírása a kimenet mellé, IDEGEN FÁJL FELÜLÍRÁSA NÉLKÜL.
   *
   * A kimeneti irat nevét a felhasználó adja meg a mentés ablakban, ott a
   * rendszer rákérdez a felülírásra. A jegyzőkönyv neve viszont SZÁRMAZTATOTT:
   * arra soha senki nem kérdezett rá, tehát egy korábbi ügy jegyzőkönyvét (vagy
   * egy azonos nevű, teljesen más fájlt) észrevétlenül írnánk felül.
   *
   * A SAJÁT, ugyanerről a forrásfájlról szóló korábbi jegyzőkönyvünket viszont
   * felülírjuk: az iratot is felülírta a felhasználó, tehát a mellé tartozó
   * elavult jegyzőkönyv megőrzése csak félrevezetne. Ami nem ilyen, ahhoz nem
   * nyúlunk: sorszámozunk, és a tényleges útvonalat visszaadjuk a felületnek.
   */
  private writeCertificate(outputPath: string, certificate: string): string {
    const stem = outputPath.replace(/\.[^.]+$/, '');
    let path = `${stem}-jegyzokonyv.txt`;
    for (let n = 2; existsSync(path) && !this.isOwnCertificate(path); n++) {
      if (n > 999) throw new Error('Nem találtam szabad nevet a jegyzőkönyvnek a kimenet mellett.');
      path = `${stem}-jegyzokonyv-${n}.txt`;
    }
    writeFileSync(path, certificate, 'utf8');
    return path;
  }

  /** Igaz, ha a fájl a MI jegyzőkönyvünk UGYANERRŐL a forrásiratról. */
  private isOwnCertificate(path: string): boolean {
    try {
      // Csak a fejlécet olvassuk vissza: a döntéshez az első néhány sor elég,
      // és egy tévedésből ideirányított nagy fájlt sem akarunk beolvasni.
      const head = readFileSync(path, 'utf8').slice(0, 512);
      return head.startsWith(CERTIFICATE_HEADER) && head.includes(`Forrásfájl:`) && head.includes(this.info.fileName);
    } catch {
      // Olvashatatlan fájl: nem tudjuk, mi az, tehát nem írjuk felül.
      return false;
    }
  }

  /**
   * Az anonimizálási jegyzőkönyv.
   *
   * SZÁNDÉKOSAN NINCS BENNE SZEREPLAP. Az „eredeti név → álnév" tábla ugyanaz
   * az adat, amit a kulcsfájl scrypt+AES-256-GCM-mel titkosít; ha titkosítatlan
   * szövegfájlban, kitalálható néven, az anonimizált irat mellé tesszük, akkor
   * a mappa kiküldésével mindent kiküldtünk. Különösen visszás volt, hogy a
   * fájl a saját fejlécében írta ki: „Kulcsfájl: nem készült
   * (visszafordíthatatlan)" — tizenkét sorral a teljes visszafejtő tábla fölött.
   *
   * Ami helyette marad: darabszám és fajtánkénti összesítés. Ebből a
   * jegyzőkönyv betölti a szerepét (mit, mennyit, milyen módon cseréltünk),
   * anélkül hogy bárkit azonosítana.
   */
  private certificate(
    opts: ExportOptions,
    replaced: number,
    pending: number,
    leaks: number,
    residualTotal: number,
    checkedChars: number,
  ): string {
    const modeLabel: Record<ReplacementMode, string> = {
      theme: 'témás álnevek',
      role: 'eljárási szerep (OBH)',
      type: 'adatfajta neve',
      numbered: 'számozott címke',
    };

    const lines = [
      CERTIFICATE_HEADER,
      '',
      `Forrásfájl:            ${this.info.fileName}`,
      `Formátum:              ${this.info.format.toUpperCase()}, ${this.info.pageCount} oldal, ${this.info.charCount} karakter`,
      `Csere módja:           ${modeLabel[opts.mode]}`,
      `Kulcsfájl:             ${opts.keepKey ? 'készült (álnevesítés — a kimenet továbbra is személyes adat)' : 'nem készült (visszafordíthatatlan)'}`,
      `Nyelvi modell:         ${modelCertificateLine(this.lastModel)}`,
      '',
      `Lecserélt előfordulás: ${replaced}`,
      // Kettéválasztva, mert a két szám két különböző dolgot mond: hány
      // találat maradt gazdátlanul, és hány olyan volt, amit a program vállalt
      // magára. Egy összevont „eldöntetlen: 0" sor automatikus módban azt
      // sugallná, hogy nem is volt mit eldönteni.
      `Eldöntetlen találat:   ${pending}`,
      `Program döntötte el:   ${this.lastAutoAccepted.length} bizonytalan találat (ember helyett)`,
      // A BENT HAGYOTT elutasított találat külön sor, mert ez az egyetlen hely,
      // ahol a program a saját döntésére hivatkozva NEM cserélt. A tételek a
      // gyanús maradványok között tételesen is ott vannak; ez a szám azt mondja
      // meg, hányat kell közülük a program számlájára írni.
      `Program bent hagyta:   ${this.autoKeptCount()} elutasított találat (a szövegkörnyezet szerint köznév)`,
      `Ellenőrzött karakter:  ${checkedChars}`,
      `Gyanús maradvány:      ${residualTotal} (emberi átnézésre)`,
      `Ellenőrző kör:         ${leaks === 0 ? 'a KÉSZ FÁJL visszaolvasva tiszta — eredeti név nem maradt benne' : `${leaks} BENNMARADT NÉV — a fájl NEM készült el`}`,
      '',
      'MIT CSERÉLTÜNK (fajtánként)',
    ];

    for (const line of this.castSummary()) lines.push(`  ${line}`);

    // AMIT A PROGRAM DÖNTÖTT EL EMBER HELYETT.
    //
    // Ez az automatikus mód ára, és a jegyzőkönyv pont attól jegyzőkönyv, hogy
    // ezt is tartalmazza. A köznévi tételek külön jelölve állnak: a fölösleges
    // cserét („Kőszikla a kockázat") itt kell keresni, és csak ez a néhány sor
    // az, amit érdemes utólag átolvasni.
    const auto = this.lastAutoAccepted;
    if (auto.length > 0) {
      const kozneviek = auto.filter((a) => a.commonWord).length;
      lines.push(
        '',
        'AMIRŐL A PROGRAM DÖNTÖTT EMBER HELYETT',
        `  ${auto.length} bizonytalan találatot a program fogadott el emberi döntés nélkül` +
          `${kozneviek > 0 ? `, ebből ${kozneviek} köznévvel azonos alakú (valószínűleg fölösleges csere)` : ''}.`,
      );
      for (const a of auto) {
        lines.push(
          `  - "${a.surface}" → ${a.replacement ?? '(nincs csere)'}` +
            `${a.commonWord ? ' [köznév is]' : ''} — ${a.page + 1}. oldal, ${a.reason}`,
        );
        lines.push(`      ${a.context}`);
      }
    }

    const warnings = this.exportWarningList();
    if (warnings.length > 0) {
      lines.push('', 'FIGYELMEZTETÉSEK');
      for (const w of warnings) lines.push(`  - ${w}`);
    }

    lines.push(
      '',
      'A ki-kicsoda megfeleltetést ez a jegyzőkönyv SZÁNDÉKOSAN nem tartalmazza: az a',
      'titkosított kulcsfájlba (.szkulcs) kerül, jelszóval védve. Enélkül a tábla',
      'titkosítatlanul feküdne az anonimizált irat mellett, és a mappa kiküldésével',
      'minden kiküldve lenne.',
      '',
      'A kimenet álnevesített, nem anonimizált, amennyiben a kulcsfájl fennmarad.',
      'A kulcsfájl önmagában is személyes adat: külön, titkosítva kell tárolni.',
      '',
      `Készült: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    );
    return lines.join('\n');
  }

  /** Hány elutasított találatot hagyott bent a program a saját döntése alapján. */
  private autoKeptCount(): number {
    return this.lastMatches.filter(({ row }) => row.autoDecided === true && row.decision === 'skip')
      .length;
  }

  /**
   * A mentés figyelmeztetései EGY helyen.
   *
   * Ugyanaz a lista megy a jegyzőkönyvbe és a felületre visszaadott
   * `ExportResult.warnings` mezőbe. Azért közös függvény, mert két külön
   * összeállítás észrevétlenül elcsúszna, és a felhasználó a képernyőn mást
   * olvasna, mint a fájlban.
   */
  private exportWarningList(): string[] {
    return [
      ...modelWarnings(this.lastModel),
      ...this.planWarnings,
      ...this.loadWarnings,
      ...this.exportWarnings,
    ];
  }

  /** Fajtánkénti összesítés: hány felet cseréltünk és hány előfordulásban. */
  private castSummary(): string[] {
    const label: Record<EntityKind, string> = {
      person: 'személy',
      org: 'szervezet',
      place: 'helység',
      identifier: 'azonosító',
    };
    const stats = new Map<string, { parties: number; occurrences: number }>();
    const bump = (key: string, occurrences: number): void => {
      const s = stats.get(key) ?? { parties: 0, occurrences: 0 };
      s.parties++;
      s.occurrences += occurrences;
      stats.set(key, s);
    };

    const occurrencesById = new Map<string, number>();
    for (const { row } of this.lastMatches) {
      if (!isAccepted(row)) continue;
      occurrencesById.set(row.entityId, (occurrencesById.get(row.entityId) ?? 0) + 1);
    }

    for (const p of this.lastParties) {
      if (p.skipped) continue;
      // Az azonosítónál a FAJTA a lényeg („adószám", „TAJ-szám"), nem az, hogy
      // azonosító — az adatfajta megjelölése az, ami a jegyzőkönyvet olvashatóvá
      // teszi, és ami az OBH 4/2021. §10(2) szerinti megoldást dokumentálja.
      const key =
        p.kind === 'identifier' && p.identifierKind
          ? `azonosító — ${AZONOSITO_NEV[p.identifierKind]}`
          : label[p.kind];
      bump(key, occurrencesById.get(p.id) ?? 0);
    }

    const amounts = occurrencesById.get(AMOUNT_ENTITY_ID) ?? 0;
    const dates = occurrencesById.get(DATE_ENTITY_ID) ?? 0;

    const out = [...stats.entries()]
      .sort((a, b) => b[1].occurrences - a[1].occurrences || a[0].localeCompare(b[0], 'hu'))
      .map(([key, s]) => `${key.padEnd(34)} ${s.parties} fél, ${s.occurrences} előfordulás`);
    if (amounts > 0) out.push(`${'pénzösszeg'.padEnd(34)} ${amounts} előfordulás átírva`);
    if (dates > 0) out.push(`${'dátum'.padEnd(34)} ${dates} előfordulás eltolva`);
    if (out.length === 0) out.push('nem cseréltünk semmit');
    return out;
  }
}

// ─────────────────────────── segédek ───────────────────────────

/**
 * Ennél rövidebb alakot nem keresünk a NYERS bájtokban. A valódi teljes nevek
 * és azonosítók mind hosszabbak; egy három-négy betűs alak viszont bináris
 * tartalomban véletlenül is előfordul, és a hamis riasztás megakadályozná a
 * mentést.
 */
const MIN_BYTE_NEEDLE = 6;

/**
 * Ennél rövidebb azonosítót nem keresünk a KIMENETI SZÖVEGBEN sem.
 *
 * Ugyanaz az érték, mint a `verify.ts` `MIN_IDENTIFIER_CHARS` küszöbe, és
 * ugyanaz az oka: egy négyjegyű szám (irányítószám, évszám) a szöveg minden
 * során illeszkedne, és a hamis riasztás megakadályozná a mentést.
 */
const MIN_IDENTIFIER_RESIDUE = 6;

/** A lap gyökér-tartalomfolyamának LAPONKÉNT EGYEDI azonosítója. */
/** A fájl kezdő bájtjai megegyeznek-e a megadott sorozattal. */
function kezdodik(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

/**
 * Támogatjuk-e ezt a fájlt — a BÁJTOK alapján, nem a kiterjesztésből.
 *
 * A kiterjesztés hazudhat, és a megnyitó párbeszéd szűrői sem védenek, mert a
 * felhasználó tetszőleges fájlnevet begépelhet. Ha egy régi .doc vagy egy .odt
 * a szöveges ágra esik, a program bináris kacatot olvas UTF-8-ként: nem talál
 * benne nevet, nem cserél semmit, és a végén azt mondja, hogy tiszta. A
 * felhasználó pedig kiadja a kezéből az ÉRINTETLEN iratot abban a hitben, hogy
 * ki van takarva. Ezért itt hangosan elutasítunk, ahogy a DOCX-ág is teszi
 * rossz bemenetnél.
 *
 * @returns a felhasználónak szóló magyar mondat, vagy `null`, ha rendben van
 */
function formatumGond(bytes: Uint8Array, ext: string): string | null {
  const pdf = kezdodik(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
  const zip = kezdodik(bytes, [0x50, 0x4b, 0x03, 0x04]); // PK..
  const ole = kezdodik(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const rtf = kezdodik(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66]); // {\rtf

  if (bytes.length === 0) return 'Ez a fájl üres.';

  if (ole) {
    return (
      'Ez a fájl a Word régi, 2007 előtti formátumában készült (.doc). Nyisd meg a Wordben, ' +
      'mentsd „Word-dokumentum (*.docx)” formátumban, és próbáld újra.'
    );
  }
  if (rtf) {
    return (
      'Ez a fájl RTF formátumú, amit a program még nem támogat. Nyisd meg a Wordben, mentsd ' +
      '„Word-dokumentum (*.docx)” formátumban, és próbáld újra.'
    );
  }

  if (ext === '.pdf' && !pdf) {
    return 'Ez a fájl .pdf néven van, de a tartalma nem PDF. Ellenőrizd, jó fájlt választottál-e.';
  }
  if (ext === '.docx' && !zip) {
    return 'Ez a fájl .docx néven van, de a tartalma nem Word-dokumentum. Ellenőrizd, jó fájlt választottál-e.';
  }

  // A ZIP-tároló önmagában nem árulja el, mi van benne. A csomagon belüli
  // jelekből döntjük el, hogy Wordről, táblázatról vagy OpenDocumentről van-e
  // szó — az utóbbi kettő ma nem támogatott, és némán feldolgozva ugyanaz a
  // hamis „tiszta” minősítés lenne a vége.
  if (zip && ext !== '.docx') {
    const eleje = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    if (eleje.includes('mimetypeapplication/vnd.oasis.opendocument')) {
      return (
        'Ez egy OpenDocument fájl (LibreOffice / OpenOffice), amit a program még nem támogat. ' +
        'Mentsd „Word-dokumentum (*.docx)” formátumban, és próbáld újra.'
      );
    }
    if (eleje.includes('xl/')) {
      return (
        'Ez egy Excel-táblázat. A táblázatok kitakarása külön munka, ezért a program egyelőre ' +
        'nem támogatja — így viszont nem is minősítheti tévesen tisztának.'
      );
    }
    if (eleje.includes('ppt/')) {
      return 'Ez egy PowerPoint-bemutató, amit a program nem támogat.';
    }
    if (eleje.includes('word/')) {
      return null; // .docx rossz kiterjesztéssel: a tartalom számít
    }
  }

  // Ami idáig eljut, azt szövegként fogjuk olvasni. Ha bináris, azt most kell
  // megmondani: a nulla bájt szövegfájlban nem fordul elő.
  if (!pdf && !zip && ext !== '.pdf' && ext !== '.docx') {
    const minta = bytes.subarray(0, Math.min(bytes.length, 8192));
    const nullak = minta.reduce((n, b) => n + (b === 0 ? 1 : 0), 0);
    if (nullak > 0 && !kezdodik(bytes, [0xff, 0xfe]) && !kezdodik(bytes, [0xfe, 0xff])) {
      return (
        'Ez a fájl nem szöveges: a program nem tudja értelmezni. PDF-et és Word-dokumentumot ' +
        '(.docx) tud megnyitni.'
      );
    }
  }

  return null;
}

function pdfRootId(pageIndex: number): string {
  return `page:${pageIndex}`;
}

function isAccepted(row: MatchRow): boolean {
  if (row.decision === 'accept') return true;
  if (row.decision === 'skip') return false;
  return row.disposition === 'auto';
}

/**
 * ELDÖNTETLEN: senki nem döntött róla, se ember, se program.
 *
 * Nem azonos a „nem cserélődik le" állapottal: a kihagyás is döntés. A kettő
 * összemosása miatt írt a jegyzőkönyv „Eldöntetlen találat" sort olyan iratra
 * is, amit a felhasználó tételesen végigdöntött — automatikus módban pedig azt
 * állította volna, hogy maradt tennivaló, holott a mód lényege, hogy nincs.
 */
function isUndecided(row: MatchRow): boolean {
  return row.decision === undefined && row.disposition !== 'auto';
}

/**
 * Ki dönt a találatról, és mit?
 *
 * Az EMBERI döntés mindig erősebb: ha a felhasználó egyszer nyilatkozott,
 * az automatikus mód nem írja felül — a „Csak csináld" azt jelenti, hogy nem
 * KELL dönteni, nem azt, hogy nem LEHET.
 *
 * Ahol nincs emberi döntés, ott automatikus módban a program dönt, és a két
 * bizonytalan fokozat KÜLÖNBÖZŐ irányba megy:
 *
 *   'review' → ELFOGADVA. A mérés szerint az óvatoskodás okozza a szivárgás
 *     nagy részét: három mintairaton 35 bennmaradt névből 34 pusztán attól
 *     maradt bent, hogy senki nem nyomott rá egy gombot.
 *   'reject' → BENT HAGYVA, kimondva. Ezek bizonyítottan nem nevek, a
 *     lecserélésük tiszta kár. A kimondás viszont fontos: az ellenőrző kör a
 *     kifejezett döntést látja jogos bent hagyásnak, a hallgatást szivárgásnak
 *     — egy néma elutasítás miatt automatikus módban nem keletkezne fájl.
 *
 * A magabiztos ('auto') találat szándékosan nem kap döntést: az alapból
 * cserélődik, és egy odaírt „elfogadva" azt a látszatot keltené, hogy ott is
 * volt mit mérlegelni.
 */
function decideFor(
  disposition: Disposition,
  userDecision: 'accept' | 'skip' | undefined,
  acceptReview: boolean,
  /**
   * A találat FAJTÁJÁRA szóló felhasználói döntés (az összeg- és a
   * dátumkapcsoló). Erősebb a fokozatnál, gyengébb az egyedi döntésnél: a
   * kapcsoló az egész iratról szól, a kattintás egyetlen helyről.
   *
   * `byProgram` NEM lesz igaz tőle: ezt is a felhasználó állította be, csak
   * egyetlen kapcsolóval sok találatra. Programdöntésnek jelölve a „döntöttünk
   * helyetted" lista minden kikapcsolt összeget felsorolna.
   */
  classDecision?: 'accept' | 'skip',
): { decision?: 'accept' | 'skip'; byProgram: boolean } {
  if (userDecision !== undefined) return { decision: userDecision, byProgram: false };
  if (classDecision !== undefined) return { decision: classDecision, byProgram: false };
  if (!acceptReview || disposition === 'auto') return { byProgram: false };
  return { decision: disposition === 'review' ? 'accept' : 'skip', byProgram: true };
}

/**
 * Köznévvel azonos alakú-e a találat? Ezek a valószínű FÖLÖSLEGES cserék.
 *
 * Két úton lehet az. A felszíni alak maga szerepelhet a köznévi listán
 * („Fehér"), de a szövegben a név rendszerint RAGOZVA áll („Szabóval"), és a
 * ragozott alakot a lista sosem tartalmazza — ilyenkor a keresés vakon menne
 * el mellette. A találat MAGJA viszont megmondja, melyik névrészre illeszkedett
 * (`Match.core`), a névrész szótári alakja pedig ott van a félben. Ezért a
 * kettőt együtt nézzük.
 */
function isCommonWordMatch(m: Match, entity: AnonEntity | undefined, homonyms: Set<string>): boolean {
  if (homonyms.has(m.surface.toLowerCase())) return true;
  if (!entity || entity.kind !== 'person') return false;
  const has = (name: string | undefined): boolean =>
    name !== undefined && homonyms.has(name.toLowerCase());
  switch (m.core) {
    case 'surname':
    case 'family':
    case 'wife_surname':
      return has(entity.surname);
    case 'maiden_surname':
      return has(entity.maidenSurname);
    case 'given':
      return has(entity.given);
    default:
      // A teljes név, a monogram és az azonosítóba ágyazott névrészlet sosem
      // téveszthető össze köznévvel: ott a másik névrész elárulja, hogy név.
      return false;
  }
}

/** Igaz a névre (személy, szervezet, helység), hamis az azonosítóra. */
function isNameEntity(e: AnonEntity): e is SeedEntity {
  return e.kind !== 'identifier';
}

function isIdentifierEntity(e: AnonEntity): e is SeedIdentifier {
  return e.kind === 'identifier';
}

/**
 * A felek azonosítói abban a sorrendben, ahogy az iratban ELŐSZÖR megjelennek.
 *
 * Ezt kapja a kiosztó (`AssignOptions.appearanceOrder`), és ebből lesz az, hogy
 * az elsőként megjelenő fél a névsor első nevét kapja. A sorrend forrása a
 * SZÖVEG, nem a felületi féllista: a féllistát a felismerő előfordulásszám
 * szerint rendezi, a felhasználó pedig átrendezheti — egyik sem az, amit az
 * olvasó az iratban lát.
 *
 * KÉT DÖNTÉS, amit itt hozunk meg:
 *
 *  - Az „elutasítva" fokozatú találatok NEM számítanak megjelenésnek. Azok
 *    bizonyítottan nem az adott felet jelölik (köznévvel egybeeső vezetéknév,
 *    „Nagy", „Fehér"), és ha beszámítanának, egyetlen fals találat a lap
 *    tetején az egész rangsort elrontaná.
 *  - Aki egyáltalán nem szerepel a szövegben, az kimarad a listából. Neki nincs
 *    megjelenési helye; a kiosztó ilyenkor a régi, kulcsból számolt nevet adja.
 *
 * Az egységek sorrendje az irat olvasási sorrendje (oldal, majd DOCX-nél a
 * csomagrészek), a találatoké ezen belül a karakterpozíció.
 */
function appearanceOrder(hitsByUnit: readonly Match[][]): string[] {
  const first = new Map<string, number>();
  let futo = 0;
  for (const hits of hitsByUnit) {
    // A találatlista sorrendje a keresőn múlik, ezért itt magunk rendezzük
    // pozíció szerint — enélkül a „megjelenés sorrendje" a kereső belső
    // működésének a sorrendje volna.
    for (const m of [...hits].sort((a, b) => a.start - b.start)) {
      if (m.disposition === 'reject') continue;
      if (!first.has(m.entityId)) first.set(m.entityId, futo++);
    }
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

function isCoveredRange(covered: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (covered[i]) return true;
  return false;
}

function markRange(covered: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) covered[i] = true;
}

/**
 * Melyik azonosító-félhez tartozik ez a szövegbeli találat.
 *
 * A tagolás NEM része az összehasonlításnak: ugyanaz a bankszámlaszám
 * szerepelhet „10402142-49575354" és „10402142 49575354" alakban is, a
 * felületen viszont a felhasználó csak az egyiket látta. A fajtának egyeznie
 * kell, mert ugyanaz a számsor lehet külön adószám és külön bankszámlablokk.
 */
function matchIdentifierEntity(
  hit: AzonositoMatch,
  entities: SeedIdentifier[],
): SeedIdentifier | undefined {
  const key = identifierKey(hit.text);
  return entities.find((e) => e.identifierKind === hit.kind && identifierKey(e.name) === key);
}

function identifierKey(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-záéíóöőúüű@.]/g, '');
}

/**
 * Kulcs a MARADVÁNYOK összevetéséhez: se tagolás, se kis-nagybetű.
 *
 * Szigorúbb, mint az `identifierKey`, mert itt a `verify.ts` jelentésével kell
 * összevetni, az pedig minden nem alfanumerikus karaktert elhagy. Ha a két
 * normalizálás eltérne, ugyanaz a szivárgás kétszer jelenne meg a listán.
 */
function residueKey(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-záéíóöőúüű]/g, '');
}

/**
 * Hányszor fordul elő a keresett alak a kimenetben, TAGOLÁSTÓL FÜGGETLENÜL.
 *
 * A visszaolvasott szövegben a szóköz máshol törhet, mint a forrásban (a PDF
 * szakaszhatárai, a DOCX futamai), ezért a szóközök helyén tetszőleges
 * elválasztást engedünk. A többi karaktert viszont pontosan kötjük: egy
 * lakcímből nem szabad „majdnem egyezésre" riasztani.
 */
function countLiteral(text: string, literal: string): number {
  const parts = literal.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (parts.length === 0) return 0;
  const re = new RegExp(parts.join('[\\s\\u00A0]*'), 'gi');
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (hasIdentifierEdge(text, m.index, m.index + m[0].length)) n++;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return n;
}

/** Magyar betű — ékezettel együtt. Az ASCII `\w` itt csendben elrontaná. */
const HU_LETTER = new RegExp(`[${HU_LETTER_CLASS}]`);

/**
 * Szóhatár azonosítókhoz — UGYANAZ a szabály, mint a `verify.ts`-ben.
 *
 * Nem betűosztály és főleg nem az ASCII szóhatár dönt, hanem az, hogy a
 * szomszédos karakter ugyanolyan fajta-e, mint a találat széle. Enélkül egy
 * tízjegyű adóazonosítót kihasítanánk egy tizenegy jegyű számsor közepéből,
 * és a hamis riasztás megakadályozná a mentést — vagyis a saját óvatosságunk
 * venné el a felhasználótól a kész iratot.
 */
function hasIdentifierEdge(text: string, start: number, end: number): boolean {
  const sameKind = (neighbour: string | undefined, edge: string): boolean => {
    if (neighbour === undefined) return false;
    if (/[0-9]/.test(edge)) return /[0-9]/.test(neighbour);
    if (HU_LETTER.test(edge)) return HU_LETTER.test(neighbour);
    return false;
  };
  return !sameKind(text[start - 1], text[start]!) && !sameKind(text[end], text[end - 1]!);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Az iratban megtalált azonosítókból FÉL, hogy a csere is lássa őket.
 *
 * A hívó által átadott azonosítókat nem duplázzuk: az ő döntése (kézi
 * csereszöveg, kihagyás) erősebb, mint a mi felvételünk. Az összehasonlítás a
 * tagolást elhagyja, mert ugyanaz a bankszámlaszám szerepelhet kötőjellel és
 * szóközzel is — a felületen viszont a felhasználó csak az egyik alakot látta.
 *
 * AZ AZONOSÍTÓ SORSZÁMOZOTT belső azonosítót kap, nem a saját értékéből
 * képzettet. Az `entityId` végigmegy a felületig, a naplókig és a
 * találatsorokig; egy „#az:taj:111111110" alakú kulcs pontosan azt a számsort
 * hordozná mindenhová, amit ki akarunk takarni.
 */
function foundIdentifierParties(
  azonositokByUnit: AzonositoMatch[][],
  given: readonly PartyInput[],
): PartyInput[] {
  const known = new Set<string>();
  for (const p of given) {
    if (p.kind !== 'identifier') continue;
    const kind = p.identifierKind ?? guessIdentifierKind(p.fullName);
    if (kind) known.add(`${kind}|${identifierKey(p.fullName)}`);
  }

  const out: PartyInput[] = [];
  const seen = new Set<string>();
  for (const hits of azonositokByUnit) {
    for (const hit of hits) {
      const key = `${hit.kind}|${identifierKey(hit.text)}`;
      if (known.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `#az${out.length + 1}`,
        kind: 'identifier',
        fullName: hit.text,
        // Az azonosítónak nincs neme; a „szerep” helyén az adatfajta neve áll,
        // hogy a szereplapon és a jegyzőkönyvben látszódjon, MIT cseréltünk.
        gender: 'N',
        role: AZONOSITO_NEV[hit.kind],
        identifierKind: hit.kind,
      });
    }
  }
  return out;
}

/**
 * Az azonosító-találat a névkereső `Match` alakjában.
 *
 * Nincs ragozási magja és nincs esete: a helyére adatfajta-megjelölés kerül
 * („[adószám]"), nem ragozott név. A `renderReplacement` az azonosítót a
 * legelső ágon kezeli, ezért a `core: null` itt nem veszteség.
 */
function identifierMatch(hit: AzonositoMatch, entityId: string): Match {
  return {
    start: hit.start,
    end: hit.end,
    surface: hit.text,
    entityId,
    core: null,
    caseTag: 'NOM',
    prefix: '',
    tail: '',
    confidence: hit.confidence,
    reason: hit.reason,
    upperCase: false,
    ambiguous: false,
    candidates: [entityId],
    autoReplaceable: hit.disposition === 'auto',
    disposition: hit.disposition,
  };
}

/** Összeg- és dátumcsere a névkereső `Match` alakjában. */
function plainMatch(
  entityId: string,
  start: number,
  end: number,
  text: string,
  confidence: number,
  reason: string,
  disposition: 'auto' | 'review',
): Match {
  return {
    start,
    end,
    surface: text.slice(start, end),
    entityId,
    core: null,
    caseTag: null,
    prefix: '',
    tail: '',
    confidence,
    reason,
    upperCase: false,
    ambiguous: false,
    candidates: [entityId],
    autoReplaceable: disposition === 'auto',
    disposition,
  };
}

/** Az ÖSSZES TÖBBI egység összegértéke — az ügyre közös kerekítési rácshoz. */
function otherUnitAmounts(
  amountsByUnit: OsszegMatch[][],
  skipUnit: number,
): { penznem: Penznem; ertek: number; tizedesek: number }[] {
  const out: { penznem: Penznem; ertek: number; tizedesek: number }[] = [];
  amountsByUnit.forEach((list, ui) => {
    if (ui === skipUnit) return;
    for (const m of list) out.push({ penznem: m.penznem, ertek: m.ertek, tizedesek: m.alak.tizedesek });
  });
  return out;
}

/**
 * A modell állapotából magyar mondat a felületnek.
 *
 * A modell a felismerés MOTORJA — nélküle csak a szerkezeti minták találnak
 * feleket, vagyis csak azok kerülnek elő, akiket az irat kifejezetten megnevez.
 * Ezért a hiba nem lábjegyzet, és a három ok három különböző teendő.
 */
function modelWarnings(status: ModelStatus): string[] {
  const out: string[] = [];
  switch (status.state) {
    case 'failed':
      out.push(
        `A NYELVI MODELL NEM FUTOTT LE: ${modelMessage(status)}. ` +
          'A felismerés kizárólag a szerkezeti mintákra támaszkodott, ezért csak azokat a ' +
          'feleket találtuk meg, akiket az irat kifejezetten megnevez („felperes:", „anyja ' +
          'neve:", cégforma). A folyó szövegben említett nevekre nem kerestünk rá. Ezt az ' +
          'iratot ne fogadd el anonimizáltként, amíg a modell újra le nem futott.',
      );
      break;
    case 'missing':
      out.push(
        'A nyelvi modell NINCS TELEPÍTVE, ezért csak a szerkezeti felismerés futott: ' +
          'a folyó szövegben említett nevekre nem kerestünk rá. Beállítások → Nyelvi modellek.',
      );
      break;
    case 'off':
      out.push(
        'A nyelvi modell KI VAN KAPCSOLVA, ezért csak a szerkezeti felismerés futott: ' +
          'a folyó szövegben említett nevekre nem kerestünk rá.',
      );
      break;
    case 'ok':
      break;
  }
  if (status.unmappedLabels && status.unmappedLabels > 0) {
    out.push(
      `A modell ${status.unmappedLabels} találatát nem tudtuk értelmezni${unmappedBreakdown(status)}: ` +
        'a nyers címkéjükhöz nincs bejegyzés a címketérképben, ezért nem kerültek a felek közé. ' +
        'Ha az iratban idegen nyelvű vagy szokatlan névformák vannak, ezeket kézzel kell felvenni.',
    );
  }
  return out;
}

/**
 * A nem értelmezett címkék FAJTÁNKÉNTI bontása, zárójeles felsorolásban.
 *
 * A puszta darabszám nem mond teendőt. „3 MISC" azt jelenti, hogy a modell
 * szemétládájából nem lett fél — ez rendben van. „3 DATE" viszont azt, hogy a
 * modell olyasmit ismer, amit a címketérképünk elhallgat, és ott a program
 * ígérete és a viselkedése tér el egymástól.
 */
function unmappedBreakdown(status: ModelStatus): string {
  const entries = Object.entries(status.unmappedByLabel ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return '';
  const shown = entries.slice(0, 6).map(([label, n]) => `${label}: ${n}`);
  if (entries.length > shown.length) shown.push('…');
  return ` (${shown.join(', ')})`;
}

/**
 * A modell hibaüzenete mondatba illesztve.
 *
 * A záró pontot levágjuk: a `client.ts` üzenetei önálló mondatok („A
 * modell-folyamat leállt (kód: 1)."), és a mi mondatunk végére kerülve két
 * pont állna egymás mellett — apróság, de a jegyzőkönyv gépiesnek látszik tőle.
 */
function modelMessage(status: ModelStatus): string {
  const raw = (status.message ?? 'ismeretlen hiba').trim();
  return raw.replace(/\.+$/, '');
}

/** A modell állapota egy sorban, a jegyzőkönyvbe. */
function modelCertificateLine(status: ModelStatus): string {
  const tail =
    status.unmappedLabels && status.unmappedLabels > 0
      ? `; ${status.unmappedLabels} találatát nem tudtuk értelmezni${unmappedBreakdown(status)}`
      : '';
  switch (status.state) {
    case 'ok':
      return `futott (${status.entityCount ?? 0} találat)${tail}`;
    case 'missing':
      return `NEM FUTOTT — nincs telepítve; csak a szerkezeti felismerés dolgozott${tail}`;
    case 'off':
      return `NEM FUTOTT — kikapcsolva; csak a szerkezeti felismerés dolgozott${tail}`;
    case 'failed':
      return `NEM FUTOTT — HIBA: ${modelMessage(status)}; csak a szerkezeti felismerés dolgozott${tail}`;
  }
}

/**
 * A cserék alkalmazása a szövegre, a HATÁROZOTT NÉVELŐ igazításával együtt.
 *
 * Magyarul a névelő a következő szó kezdőhangjától függ: „a Kovács”, de „az
 * Aranyos”. Ha a csere magánhangzóval kezdődő álnevet tesz egy mássalhangzóval
 * kezdődő név helyére, az elé ragadt „a” hibás lesz. Ez nem szépséghiba: egy
 * ügyvéd az első bekezdésben észreveszi, és onnantól nem bízik a programban.
 * Ráadásul árulkodó is — a rossz névelőből meg lehet mondani, hol állt
 * eredetileg név.
 *
 * A javítás sokáig csak a `substitute()`-ban élt, amit viszont kizárólag a
 * mérőfuttatások hívnak; az igazi program ezen az úton megy, tehát a valódi
 * kimeneten SOSEM futott le.
 */
function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) continue;
    // A névelő a MÁR ÖSSZEÁLLÍTOTT kimenet végén áll, nem a forrásban: ha két
    // csere egymás után jön, az elsőnek a javítása is látszik itt.
    out = fixDefiniteArticle(out + text.slice(cursor, e.start), e.replacement);
    out += e.replacement;
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

function contextAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 45);
  const to = Math.min(text.length, end + 45);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return `${prefix}${text.slice(from, start)}⟦${text.slice(start, end)}⟧${text.slice(end, to)}${suffix}`.replace(/\s+/g, ' ');
}

/**
 * A felületi űrlapból magyar névszerkezet vagy azonosító.
 *
 * A `warnings` azért kimenő paraméter, mert egy fel nem dolgozható fél nem
 * tűnhet el némán: ha az azonosító fajtáját sem a felület, sem a felismerő nem
 * tudja megmondani, akkor nem találunk ki neki adatfajta-címkét — hanem
 * kimondjuk, hogy nem cseréltük ki.
 */
export function toEntity(p: PartyInput, warnings: string[] = []): AnonEntity | null {
  if (p.kind === 'identifier') {
    const identifierKind = p.identifierKind ?? guessIdentifierKind(p.fullName);
    if (!identifierKind) {
      warnings.push(
        `A(z) „${p.fullName}" azonosító fajtáját nem sikerült megállapítani, ezért NEM cseréltük ` +
          'ki. Adj meg hozzá kézi csereszöveget, vagy vedd fel a megfelelő fajtával.',
      );
      return null;
    }
    return { kind: 'identifier', id: p.id, name: p.fullName.trim(), identifierKind };
  }

  if (p.kind === 'org') {
    return { kind: 'org', id: p.id, name: p.fullName.trim(), role: p.role, ...(p.abbreviation ? { abbreviation: p.abbreviation } : {}) };
  }
  if (p.kind === 'place') {
    return { kind: 'place', id: p.id, name: p.fullName.trim() };
  }

  const bare = p.fullName.trim().replace(TITLE_PREFIX, '').trim();
  const parts = bare.split(/\s+/);

  // "Baloghné Fehér Ilona": férj vezetékneve + -né, leánykori vezetéknév, keresztnév.
  const withMaiden = /^(.+?)né$/.exec(parts[0] ?? '');
  if (withMaiden && parts.length >= 3 && p.gender === 'F') {
    return {
      kind: 'person',
      id: p.id,
      surname: withMaiden[1]!,
      given: parts[parts.length - 1]!,
      maidenSurname: parts.slice(1, -1).join(' '),
      wifeOf: withMaiden[1]!,
      gender: 'F',
      role: p.role,
    };
  }

  // "Kovács Jánosné": a férj teljes nevéből képzett asszonynév.
  const married = /^(.*?)né$/.exec(bare);
  if (married && p.gender === 'F' && parts.length >= 2) {
    const hp = married[1]!.trim().split(/\s+/);
    return {
      kind: 'person',
      id: p.id,
      surname: hp[0] ?? bare,
      given: hp.slice(1).join(' '),
      wifeOf: married[1]!.trim(),
      gender: 'F',
      role: p.role,
    };
  }

  return {
    kind: 'person',
    id: p.id,
    surname: parts[0] ?? bare,
    given: parts.slice(1).join(' '),
    gender: p.gender,
    role: p.role,
  };
}

/**
 * Az azonosító fajtája a felszíni alakjából, ha a felület nem adta meg.
 *
 * Nem találgatás: ugyanaz a felismerő fut rá, ami az iratban is megtalálta.
 */
function guessIdentifierKind(text: string): AzonositoKind | null {
  const hits = resolveOverlaps(findAzonositok(text));
  const best = hits.reduce<AzonositoMatch | null>(
    (a, b) => (a === null || b.end - b.start > a.end - a.start ? b : a),
    null,
  );
  return best?.kind ?? null;
}

function ambiguousGivenNames(entities: AnonEntity[]): Set<string> {
  const counts = new Map<string, number>();
  for (const e of entities) {
    if (e.kind !== 'person') continue;
    const k = e.given.toLowerCase();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
}

/** Kézzel beírt álnév beépítése a hozzárendelésbe. */
function applyManualReplacement(a: Assignment, value: string): void {
  a.display = value;
  a.manual = true;
  if (a.pseudo.kind === 'person') {
    const parts = value.trim().split(/\s+/);
    const person = a.pseudo as SeedPerson;
    person.surname = parts[0] ?? value;
    person.given = parts.slice(1).join(' ');
    if (person.wifeOf) person.wifeOf = inflectName(value.replace(/né$/, ''), 'NOM');
  } else if (a.pseudo.kind === 'org') {
    a.pseudo.name = value;
  } else {
    a.pseudo.name = value;
  }
}

// ─────────────────────── PDF-metaadat ───────────────────────

/**
 * A PDF metaadatának kitakarítása.
 *
 * A hat `doc.set*()` hívás KIZÁRÓLAG az /Info szótárat írja. Érintetlen maradt
 * a katalógus /Metadata XMP-csomagja (benne dc:creator, xmp:CreatorTool, és
 * gyakran az eredeti fájlútvonal a Windows-felhasználónévvel), az /Annots
 * (jegyzetszerző és jegyzetszöveg), az AcroForm mezőértékek, a /Names
 * /EmbeddedFiles mellékletek és az /Outlines könyvjelzőcímek. A DOCX-oldalon ez
 * a hibaosztály végig van gondolva — a metaadat-ígéret viszont a felületen
 * MINDKÉT formátumra elhangzik.
 *
 * Amit törlünk, azt KIMONDJUK: a jegyzet, a melléklet és az űrlapmező tartalma
 * az irat része lehetett, és a felhasználónak tudnia kell, hogy a kimenetből
 * kimaradt.
 */
function scrubPdfMetadata(doc: PDFDocument): string[] {
  const warnings: string[] = [];

  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(METADATA_EPOCH);
  doc.setModificationDate(METADATA_EPOCH);

  const catalog = doc.catalog;

  // XMP: a /Info szótár párja, csak XML-ben. Sok készítő IDE írja az eredeti
  // fájl elérési útját is — a Windows-felhasználónévvel együtt.
  if (catalog.has(PDFName.of('Metadata'))) {
    catalog.delete(PDFName.of('Metadata'));
    warnings.push('A PDF XMP-metaadatcsomagját (szerző, készítő program, eredeti fájlútvonal) töröltük.');
  }
  if (catalog.has(PDFName.of('PieceInfo'))) catalog.delete(PDFName.of('PieceInfo'));
  // Beágyazott parancsfájl a megnyitáskor: se nem szöveg, se nem metaadat,
  // de a kimeneti iratnak nincs rá szüksége.
  if (catalog.has(PDFName.of('AA'))) catalog.delete(PDFName.of('AA'));

  // Címkézett PDF szerkezetfája. Az /ActualText és az /Alt bejegyzés SZÓ
  // SZERINT tartalmazhatja a lap szövegét — a lapon kitörölt nevet is. A
  // tartalomfolyamból nem érhető el, tehát a cserénk nem nyúlt hozzá; ott
  // hagyva viszont az ellenőrző kör (helyesen) szivárgásként bukna el rajta,
  // és a felhasználó egyáltalán nem kapna kimenetet.
  if (catalog.has(PDFName.of('StructTreeRoot'))) {
    catalog.delete(PDFName.of('StructTreeRoot'));
    catalog.delete(PDFName.of('MarkInfo'));
    warnings.push(
      'A címkézett PDF szerkezetfáját (StructTreeRoot) eltávolítottuk: az /ActualText ' +
        'bejegyzései szó szerint őrzik az eredeti szöveget. A kimenet emiatt kevésbé ' +
        'akadálymentes, mint a forrás.',
    );
  }

  // Könyvjelzők: a címükben rendszeresen ott a fél neve („Kovács János keresete").
  if (catalog.has(PDFName.of('Outlines'))) {
    catalog.delete(PDFName.of('Outlines'));
    warnings.push('A könyvjelzőket (Outlines) eltávolítottuk: a címük nevet tartalmazhat.');
  }

  // Mellékletek és beágyazott parancsfájl: önálló fájlok a fájlban, a
  // tartalmukat nem néztük át — ezért nem is vihetjük tovább.
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  for (const key of ['EmbeddedFiles', 'JavaScript']) {
    if (names?.has(PDFName.of(key))) {
      names.delete(PDFName.of(key));
      warnings.push(
        `A PDF /${key} bejegyzését eltávolítottuk: a beágyazott állomány tartalmát nem néztük át.`,
      );
    }
  }

  // Űrlap: a kitöltött mezők értéke (/V) és a megjelenítő folyama (/AP) is
  // hordozza a beírt szöveget, a lap tartalomfolyamában viszont nyoma sincs —
  // vagyis sem a keresés, sem a törlés nem érte el.
  if (catalog.has(PDFName.of('AcroForm'))) {
    catalog.delete(PDFName.of('AcroForm'));
    warnings.push('Az űrlapmezőket (AcroForm) eltávolítottuk: a kitöltött értékük nem cserélhető ki a helyén.');
  }

  let annots = 0;
  for (let pi = 0; pi < doc.getPageCount(); pi++) {
    const node = doc.getPage(pi).node;
    const list = node.Annots();
    if (list) {
      annots += list.size();
      node.delete(PDFName.of('Annots'));
    }
    if (node.has(PDFName.of('PieceInfo'))) node.delete(PDFName.of('PieceInfo'));
    if (node.has(PDFName.of('Metadata'))) node.delete(PDFName.of('Metadata'));
  }
  if (annots > 0) {
    warnings.push(
      `${annots} PDF-jegyzetet/annotációt eltávolítottunk: a szerzőjük és a szövegük ` +
        'metaadatként hordozza a nevet, és a lap tartalomfolyamában nem szerepel.',
    );
  }

  const orphans = purgeUnreachableObjects(doc);
  if (orphans > 0) {
    warnings.push(
      `${orphans} olyan PDF-objektumot töröltünk a fájlból, amelyre már semmi nem hivatkozik ` +
        '(eltávolított jegyzetek, könyvjelzők, korábbi mentések maradványai).',
    );
  }
  return warnings;
}

/**
 * A már nem hivatkozott objektumok TÖRLÉSE a fájlból.
 *
 * A pdf-lib mentéskor MINDEN nyilvántartott közvetett objektumot kiír, akkor is,
 * ha a katalógusból nem érhető el többé. A hivatkozás elvágása tehát csak
 * LÁTHATATLANNÁ tenné a jegyzet szövegét és a könyvjelző címét: a fájlban
 * változatlanul ott maradnának, és egy kicsomagoló azonnal megtalálná őket. Ezt
 * a hibát a saját ellenőrző körünk találta meg — pontosan azért, mert a KÉSZ
 * BÁJTOKAT nézi, nem a szándékunkat.
 *
 * Elérhetőségi bejárás, nem célzott törlés: így nem tőlünk függ, eszünkbe
 * jut-e egy hely, és a forrásfájl korábbi növekményes mentéseiből ottfelejtett
 * árva objektumok is eltűnnek. Amit a katalógus (vagy a trailer) elér, ahhoz
 * nem nyúlunk — megosztott betűkészletet vagy képet sosem törlünk ki alóla.
 */
function purgeUnreachableObjects(doc: PDFDocument): number {
  const ctx = doc.context;
  const reachable = new Set<string>();
  const stack: unknown[] = [
    ctx.trailerInfo.Root,
    ctx.trailerInfo.Info,
    ctx.trailerInfo.ID,
    ctx.trailerInfo.Encrypt,
    doc.catalog,
  ];

  while (stack.length > 0) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (reachable.has(obj.tag)) continue;
      reachable.add(obj.tag);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
      continue;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
      continue;
    }
    if (obj instanceof PDFStream) {
      stack.push(obj.dict);
      continue;
    }
    if (obj instanceof PDFDict) {
      for (const value of obj.values()) stack.push(value);
    }
  }

  let deleted = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (reachable.has(ref.tag)) continue;
    ctx.delete(ref);
    deleted++;
  }
  return deleted;
}

/**
 * Minden SZÖVEGES metaadat a kész PDF-ből, az ellenőrző körnek.
 *
 * Nem szerkezet szerint járjuk be, hanem az összes közvetett objektumot: így
 * nem tőlünk függ, eszünkbe jut-e egy hely. Ami karakterlánc vagy XMP-csomag a
 * fájlban, azt az ellenőrzés ugyanúgy átnézi, mint a lap szövegét — enélkül a
 * felületi mondat („sem a szövegben, sem a metaadatban”) nem ellenőrzött
 * állítás, hanem ígéret.
 */
function collectPdfStrings(doc: PDFDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === '' || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  const walk = (obj: unknown, depth: number): void => {
    if (depth > 12) return;
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      try {
        add(obj.decodeText());
      } catch {
        // Ismeretlen kódolású karakterlánc: a nyers alakot is átnézetjük.
        add(obj.asString());
      }
      return;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) walk(obj.get(i), depth + 1);
      return;
    }
    if (obj instanceof PDFStream) {
      // A /Metadata folyam maga az XMP-csomag: szöveg, nem bináris tartalom.
      const type = obj.dict.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.asString() === '/Metadata') {
        try {
          const bytes = obj instanceof PDFRawStream ? decodePDFRawStream(obj).decode() : obj.getContents();
          add(Buffer.from(bytes).toString('utf8'));
        } catch {
          // Kicsomagolhatatlan XMP: a szótárát így is átnézzük.
        }
      }
      walk(obj.dict, depth + 1);
      return;
    }
    if (obj instanceof PDFDict) {
      // A hivatkozásokat nem követjük: minden közvetett objektum úgyis külön
      // sorra kerül, a követés viszont körbe is vezethetne.
      for (const value of obj.values()) walk(value, depth + 1);
    }
  };

  for (const [, obj] of doc.context.enumerateIndirectObjects()) walk(obj, 0);
  walk(doc.context.trailerInfo.Info, 0);
  return out;
}

// ─────────────────────── PDF-megjelenítés ───────────────────────

/** Kiemelő téglalap a lap méretének arányában. */
function highlightFor(
  pdf: NonNullable<TextUnit['pdf']>,
  m: Match,
): { left: number; top: number; width: number; height: number } | null {
  const span = pdf.pageText.spans.find((s) => s.start <= m.start && m.start < s.end);
  if (!span) return null;
  const seg = span.segment;
  const localStart = m.start - span.start;
  const localEnd = Math.min(m.end - span.start, seg.text.length);

  const startRun = seg.runs.find((r) => r.textStart <= localStart && localStart < r.textEnd) ?? seg.runs[0];
  if (!startRun) return null;
  const endRunIndex = seg.runs.findIndex((r) => r.textStart < localEnd && localEnd <= r.textEnd);
  const endRun = endRunIndex >= 0 ? seg.runs[endRunIndex] : seg.runs[seg.runs.length - 1];
  if (!endRun) return null;

  const after = endRunIndex >= 0 ? seg.runs[endRunIndex + 1] : undefined;
  const endX = after ? after.x : endRun.x + seg.fontSize * 0.55 * Math.max(1, endRun.textEnd - endRun.textStart);

  const x = Math.min(startRun.x, endX);
  const w = Math.max(seg.fontSize * 0.4, Math.abs(endX - startRun.x));
  const ascent = seg.fontSize * 0.82;
  const descent = seg.fontSize * 0.24;

  return {
    left: x / pdf.pageWidth,
    top: (pdf.pageHeight - (startRun.y + ascent)) / pdf.pageHeight,
    width: w / pdf.pageWidth,
    height: (ascent + descent) / pdf.pageHeight,
  };
}

/**
 * Kiemelő téglalap a KÉSZ (újrarajzolt) sorban.
 *
 * A `highlightFor` párja, más bemenettel: az az EREDETI lapon méri a találat
 * helyét a forrás betűszélesség-becslésével, ez a kimeneti lapon a csereszöveg
 * helyét — azzal a betűvel és mérettel mérve, amivel a sort ténylegesen
 * kirajzoljuk. Ezért nem becslés: a `drawText` ugyanezt a szélességet kapja.
 *
 * `null`, ha a mérés nem megy (a betűkészletből hiányzó jel). A kiemelés
 * díszítés — a hiánya nem áshatja alá az előnézetet.
 */
function redrawHighlight(
  font: PDFFont,
  seg: TextSegment,
  newText: string,
  p: EditPlacement,
  pdf: NonNullable<TextUnit['pdf']>,
): { left: number; top: number; width: number; height: number } | null {
  let x: number;
  let w: number;
  try {
    x = seg.x + font.widthOfTextAtSize(newText.slice(0, p.start), seg.fontSize);
    w = font.widthOfTextAtSize(newText.slice(p.start, p.end), seg.fontSize);
  } catch {
    return null;
  }
  if (!Number.isFinite(x) || !Number.isFinite(w) || w <= 0) return null;
  // Ugyanaz a két arányszám, mint a `highlightFor`-ban: a sor alapvonala
  // felett és alatt ennyi a betűtest. Két külön szám két nézeten azt adná,
  // hogy ugyanaz a szó az eredetin és az előnézeten más magasan ül.
  const ascent = seg.fontSize * 0.82;
  const descent = seg.fontSize * 0.24;
  return {
    left: x / pdf.pageWidth,
    top: (pdf.pageHeight - (seg.y + ascent)) / pdf.pageHeight,
    width: w / pdf.pageWidth,
    height: (ascent + descent) / pdf.pageHeight,
  };
}

/**
 * A BEKEZDÉS SZÖVEGÉNEK RENDBETÉTELE A TÖRDELÉS ELŐTT.
 *
 * A csere a szakaszhatáron ÁTNYÚLHAT: a „Kovács" a sor végén áll, a „Jánosnak."
 * a következő sor elején. Ilyenkor az álnév teljes egészében az ELSŐ szakaszba
 * kerül, a másodikból pedig csak a lefedett rész marad ki — a maradék („.
 * Kis összegű…") a szóközös összefűzés után szóközzel kezdődik, és a
 * bekezdésben „Bazaltnak . Kis" áll.
 *
 * Soronkénti rajzolásnál ez a sortörés mögé bújt; a bekezdés újratördelése
 * viszont egy sorba hozza a kettőt, és ott már kiabál. Magyarul a pont, a
 * vessző és a záró idézőjel elé sosem kerül szóköz — a javítás tehát nem
 * kozmetika, hanem az, amit a szedő is tett volna.
 */
function tisztitottBekezdes(szoveg: string): string {
  return szoveg
    .replace(/\s+([.,;:!?%)\]}»”"])/g, '$1')
    .replace(/([(\[{«„])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * A SZÖVEG SZÉLESSÉGE — a beágyazott betűvel, hibatűrően.
 *
 * A `widthOfTextAtSize` a betűkészletből hiányzó jelre dobhat. A tördelés
 * ilyenkor sem állhat le: a becslés (0,55 × betűméret karakterenként) ugyanaz
 * az arány, amit a kiemelés téglalapja is használ — pontatlanabb, de a
 * bekezdés kirajzolódik.
 */
function merSzelesseg(font: PDFFont, szoveg: string, meret: number): number {
  try {
    const w = font.widthOfTextAtSize(szoveg, meret);
    return Number.isFinite(w) ? w : szoveg.length * meret * 0.55;
  } catch {
    return szoveg.length * meret * 0.55;
  }
}

/**
 * EGY CSERESZÖVEG KIEMELÉSEI AZ ÚJRATÖRDELT BEKEZDÉSBEN.
 *
 * Soronként egy téglalap: a csereszöveg átnyúlhat a sor végén a következőbe
 * („Kristályos<sortörés>Ametiszt"), és egyetlen, két sort átfogó doboz a
 * köztük lévő sort is bekarikázná.
 */
function tordeltKiemelesek(
  sorok: TordeltSor[],
  kezd: number,
  veg: number,
  meret: number,
  pdf: NonNullable<TextUnit['pdf']>,
): { left: number; top: number; width: number; height: number }[] {
  const ascent = meret * 0.82;
  const descent = meret * 0.24;
  const out: { left: number; top: number; width: number; height: number }[] = [];
  for (const sor of sorok) {
    const erintett = sor.szavak.filter((sz) => sz.kezd < veg && kezd < sz.veg);
    if (erintett.length === 0) continue;
    const bal = Math.min(...erintett.map((sz) => sz.x));
    const jobb = Math.max(...erintett.map((sz) => sz.x + sz.szelesseg));
    if (jobb <= bal) continue;
    out.push({
      left: bal / pdf.pageWidth,
      top: (pdf.pageHeight - (sor.y + ascent)) / pdf.pageHeight,
      width: (jobb - bal) / pdf.pageWidth,
      height: (ascent + descent) / pdf.pageHeight,
    });
  }
  return out;
}

async function renderPdfPages(bytes: Uint8Array, pageCount: number, units: TextUnit[]): Promise<PageImage[]> {
  const out: PageImage[] = [];
  try {
    // A behúzás a TRY-ON BELÜL van. A `pdf-to-img` a natív rajzolót (canvas)
    // húzza magával, ami a telepítőben hiányozhat vagy rossz ABI-val érkezhet:
    // ilyenkor maga az import dob. Kívülről a hiba a megnyitás nyers hibájaként
    // csapódott ki („Cannot find module…”), és a megnyitás elbukott — pedig a
    // lapkép csak megjelenítés, az anonimizálás nélküle is elvégezhető.
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(Buffer.from(bytes), { scale: 1.5 });
    let i = 0;
    for await (const page of doc) {
      const unit = units[i];
      out.push({
        index: i,
        dataUrl: `data:image/png;base64,${Buffer.from(page).toString('base64')}`,
        width: 0,
        height: 0,
        pageWidth: unit?.pdf?.pageWidth ?? 595,
        pageHeight: unit?.pdf?.pageHeight ?? 842,
      });
      if (++i >= pageCount) break;
    }
  } catch {
    // A megjelenítés hibája nem akadályozhatja meg az anonimizálást.
  }
  return out;
}

/** Emberi megnevezés a csomagrészekhez, hogy a felületen ne fájlnevek álljanak. */
function docxPartLabel(name: string, kind: string): string {
  if (name === 'word/document.xml') return 'törzsszöveg';
  if (/^word\/header\d*\.xml$/.test(name)) return 'élőfej';
  if (/^word\/footer\d*\.xml$/.test(name)) return 'élőláb';
  if (name === 'word/footnotes.xml') return 'lábjegyzetek';
  if (name === 'word/endnotes.xml') return 'végjegyzetek';
  if (name.startsWith('word/comments')) return 'megjegyzések';
  if (name.startsWith('word/glossary/')) return 'szövegtár';
  if (name.startsWith('word/charts/')) return 'diagram';
  if (name.startsWith('word/diagrams/')) return 'ábra';
  if (name.startsWith('docProps/')) return 'dokumentum-tulajdonságok';
  if (name.startsWith('customXml/')) return 'egyéni XML';
  if (name.endsWith('.rels')) return 'hivatkozások';
  return kind;
}

export function newPartyId(): string {
  return randomUUID().slice(0, 8);
}

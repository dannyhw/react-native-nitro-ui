/**
 * Question 2 of Q10 Appendix E, on iOS: the Form's inset-grouped list against the same
 * three sections in a SwiftUI `Form`, measured by the same Swift code reading the
 * `UICollectionView` that is currently in the Form's box.
 *
 * Both are UIKit grouped lists; what differs is the front end that configures them, which is
 * exactly what the question asks. Every number is the layout's own answer - item frame,
 * corner radius, separator start, supplementary frames - never a constant, and the go line is
 * 1 pt.
 *
 * The two lists are on screen with the same width and the same traits, which is the one
 * place the fidelity question can be answered; the suite runs once per trait set (light,
 * dark, the largest content size), which is why it is its own gate rather than a case
 * inside `Form.harness`.
 *
 * Android has no platform `Form` to compare with, so the case there only checks that the
 * Form measured itself, and the report says the Android half of question 2 is the
 * `SegmentedListItem` shape check in `Form.harness`.
 */
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';

import { Form } from '../../src/components/Form/Form';

const IOS = Platform.OS === 'ios';

type FormHandle = {
  nuiTestFormReport(): string;
  nuiTestCommand(command: string): void;
};

const forms: Record<string, FormHandle> = {};

/** A section handle: its own report is where the header and footer bands are measured. */
type SectionHandle = { nuiTestSectionReport(): string };

const sections: Record<string, SectionHandle> = {};

/** A row handle: its own `frame` is the truth the shapes are measured against. */
type RowHandle = { nuiTestRowReport(): string };

const rows: Record<string, RowHandle> = {};

/** Names what is on screen, so a screenshot or a log says which list is up. */
let setPhase: (phase: string) => void = () => {};

/** The line under the form, naming the phase `showPhase()` just set. */
function Banner() {
  const [phase, name] = useState('mounting');
  setPhase = name;
  return (
    <Text style={styles.banner} testID={`phase-${phase}`}>
      {phase}
    </Text>
  );
}

/** The Form under test - fail loudly rather than reading a method off `undefined`. */
function theForm(): FormHandle {
  const form = forms.form;
  if (form == null)
    throw new Error('expected the Form handle and there is none');
  return form;
}

function parse(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function num(report: Record<string, string>, key: string): number {
  const value = Number(report[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`"${key}" is not a number in ${JSON.stringify(report)}`);
  }
  return value;
}

async function read(
  ok: (r: Record<string, string>) => boolean,
  what: string
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    // A first read is often "pending", which parses to {}, and before the native view has
    // published its handle there is no report to read at all - so the poll swallows both
    // rather than letting them out through the assertion.
    try {
      const report = parse(theForm().nuiTestFormReport());
      if (ok(report)) return report;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `never saw "${what}" - last was ${String(
          forms.form?.nuiTestFormReport() ?? '<no handle>'
        )}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Read a section's own report until Compose has measured the header band.
 *
 * The bands are not in the Form's report and cannot be: a Form has several sections, and the
 * numbers belong to one of them. So the case asks the section that owns them, the same way
 * `Form.harness` asks a section for its shapes.
 */
async function readSection(
  which = 'first',
  ok: (r: Record<string, string>) => boolean = () => true
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    try {
      const report = parse(sections[which]?.nuiTestSectionReport() ?? '');
      if (ok(report)) return report;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `never saw the "${which}" section report satisfied - last was ` +
          `${String(sections[which]?.nuiTestSectionReport() ?? '<no handle>')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** One of the `left,top,width,height` dp fields the reports carry. */
type Box = [number, number, number, number];

function box(field: string | undefined): Box {
  const parts = (field ?? '').split(',').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`"${String(field)}" is not a left,top,width,height box`);
  }
  return [
    parts[0] as number,
    parts[1] as number,
    parts[2] as number,
    parts[3] as number,
  ];
}

/**
 * Say how a placed accessory differs from the row it belongs to.
 *
 * A disclosure sits inside the row's trailing edge, level with its middle - the same thing the
 * layer's own offset asks for, so every number here is the row's rather than a copy of a
 * constant from `FormListMetrics`.
 */
function accessoryIssues(accessory: Box, rowBox: Box): string[] {
  const issues: string[] = [];
  const centre = (b: Box) => b[1] + b[3] / 2;
  const rowRight = rowBox[0] + rowBox[2];
  if (accessory[0] < rowBox[0] - 1) {
    issues.push(
      `the accessory starts at x=${accessory[0]} dp, left of its row at x=${rowBox[0]} dp`
    );
  }
  if (accessory[0] + accessory[2] > rowRight + 1) {
    issues.push(
      `the accessory ends at x=${(accessory[0] + accessory[2]).toFixed(1)} dp, past its ` +
        `row's trailing edge at x=${rowRight.toFixed(1)} dp`
    );
  }
  if (Math.abs(centre(accessory) - centre(rowBox)) > 1) {
    issues.push(
      `the accessory is centred at y=${centre(accessory).toFixed(1)} dp while its row is ` +
        `centred at y=${centre(rowBox).toFixed(1)} dp`
    );
  }
  return issues;
}

/**
 * Name on screen which list is being measured, and let the banner reach the screen.
 *
 * The spike held this open for nine seconds so a person could photograph the two screens at
 * the same traits. What settles the question now is the table this case prints - every
 * number is the layout's own answer - so the wait is a settle, not a photo window; the log
 * line stays because whoever does want a picture still needs to know which list is up.
 */
async function showPhase(marker: string): Promise<void> {
  setPhase(marker);
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log(`FORM FIDELITY phase ${marker}`);
}

/** The same nine rows the reference shows, as our Form renders them. */
function FidelityForm() {
  return (
    <Form
      hybridRef={(view) => {
        forms.form = view;
      }}
      style={styles.form}
    >
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => {
          sections.first = view;
        }}
        title="Connectivity"
      >
        <Form.Row>
          <Text>Wi-Fi</Text>
        </Form.Row>
        <Form.Row>
          <Text>Bluetooth</Text>
        </Form.Row>
        <Form.Row>
          <Text>Cellular data</Text>
        </Form.Row>
        <Form.Row>
          <Text>Ring on receipt</Text>
        </Form.Row>
      </Form.Section>
      <Form.Section title="Sound">
        <Form.Row>
          <Text>ringer</Text>
        </Form.Row>
        <Form.Row>
          <Text>alert</Text>
        </Form.Row>
        <Form.Row>
          <Text>notification</Text>
        </Form.Row>
      </Form.Section>
      <Form.Section title="About">
        <Form.Row>
          <Text>nitro-ui 0.4.0</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

/**
 * The `Sections` story's box: a padded container and a Form with a height, rather than a
 * Form that fills the window.
 *
 * That is the shape a settings screen has, it is the page the README picture is taken from,
 * and - because a section learns its header and footer bands from a round trip through
 * JavaScript - it is a Form whose rows move *after* their first layout, which is the moment
 * the shape layer has to keep up with. The fixture above is filled by its parent from the
 * first frame and never shows it.
 */
function StoryForm() {
  return (
    <View style={styles.storyOuter}>
      <Form style={styles.storyForm}>
        <Form.Section
          footer="Push arrives on this device only."
          hybridRef={(view) => {
            sections.story = view;
          }}
          title="Notifications"
        >
          <Form.Row
            accessory="disclosure"
            hybridRef={(view) => {
              rows.storyFirst = view;
            }}
          >
            <Text>Push notifications</Text>
          </Form.Row>
          <Form.Row
            hybridRef={(view) => {
              rows.storySecond = view;
            }}
          >
            <Text>Play a sound</Text>
          </Form.Row>
        </Form.Section>
      </Form>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  storyOuter: { flex: 1, padding: 16 },
  storyForm: { height: 420 },
  banner: { paddingHorizontal: 8, paddingVertical: 2, fontSize: 11 },
});

/** The container metrics question 2 names, plus the two the go line implies for separators. */
const FIELDS = [
  'listW',
  'x',
  'w',
  'h0',
  'h1',
  'h2',
  'radius',
  'sep',
  'headerX',
  'headerY',
  'headerH',
  'footerH',
] as const;

/** How far a container metric may drift from SwiftUI's list, in pt. */
const CONTAINER_BOUND_PT = 1;
/**
 * How far a row's box may drift from SwiftUI's, in pt - see the note on the
 * comparison.
 *
 * It used to be 8, which is how a row 8 pt too tall shipped as a pass: the bound and the
 * bug were the same number. S6's answer minted the cell's chrome instead (`rowChrome`),
 * so the bound is now what a reader could call a match.
 */
const ROW_BOX_BOUND_PT = 0.5;

describe('Form fidelity against a SwiftUI Form (E2)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(forms)) delete forms[key];
    for (const key of Object.keys(sections)) delete sections[key];
    for (const key of Object.keys(rows)) delete rows[key];
  });

  it('measures the Form and a SwiftUI Form the same way (E2)', async () => {
    // The banner is the only way to tell the two screens apart in a screenshot, and a
    // screenshot is the evidence question 2 asks for.
    render(
      <View style={{ flex: 1 }}>
        <FidelityForm />
        <Banner />
      </View>
    );
    const proto = await read(
      // `kind` is iOS-only: it names which list the probe measured. Android has one list,
      // so its report has nothing of the kind to match on.
      (r) => num(r, 'rows') === 8 && (!IOS || r.kind === 'prototype'),
      'the nitro-ui Form list'
    );

    console.log(`FORM GEOM nitro-ui ${theForm().nuiTestFormReport()}`);
    await showPhase('nitro-ui Form');

    if (!IOS) {
      // No platform Form on Android: measuring our own list is the whole iOS-free half.
      expect(num(proto, 'rows')).toBe(8);
      // ...except the one thing only Android can get wrong. The header and footer are
      // Compose text in a layer *under* the rows, so the rows cover whatever Yoga failed
      // to reserve: S6 reserved the glyphs alone and every header lost its lower half
      // (form-android.png). The band therefore has to be the glyphs *plus* its padding -
      // the padding itself is FormListMetrics' (16 dp / 12 dp), and what this insists on
      // is that the reservation is not the glyph box: put `onSizeChanged` back inside the
      // padding and both lines below go red at once.
      const bands = await readSection('first', (r) => {
        num(r, 'headerBand');
        num(r, 'footerBand');
        return true;
      });
      console.log(`FORM BANDS first section ${JSON.stringify(bands)}`);
      const padding = (band: string, text: string) =>
        num(bands, band) - num(bands, text);
      expect(padding('headerBand', 'headerText')).toBeGreaterThanOrEqual(8);
      expect(padding('footerBand', 'footerText')).toBeGreaterThanOrEqual(4);

      // The other thing only Android can get wrong, and the one no View frame can show. The
      // layer is placed by Compose, and Compose places inside the box it was *measured* under -
      // which is not the section's box unless the section says so, because a Nitro host's
      // content is measured with an unbounded height (`NitroUiMeasuredRoot`). A decoration that
      // answered those constraints with `fillMaxSize` filled its own content instead: measured
      // here at 54.1 dp inside a section 296.4 dp tall, which is a footer bottom-aligned over
      // the header and a section whose rows have no container at all. Read once the section has
      // really grown into its footer band, so this cannot pass by being early; `layerH` is the
      // layer's own `onSizeChanged`, not a constant.
      const settled = await readSection('first', (r) => {
        const lastRowBottom = (r.rects ?? '')
          .split(',')
          .filter((entry) => entry.includes('-'))
          .reduce((bottom, entry) => {
            const edge = entry.split('-').map(Number);
            return Math.max(bottom, (edge[0] ?? 0) + (edge[1] ?? 0));
          }, 0);
        return (
          num(r, 'layerH') > 0 &&
          num(r, 'boxH') >= lastRowBottom + num(r, 'footerBand')
        );
      });
      console.log(`FORM LAYER first section ${JSON.stringify(settled)}`);
      const outBy = num(settled, 'boxH') - num(settled, 'layerH');
      if (Math.abs(outBy) > 1) {
        throw new Error(
          `question 2: the section draws into a layer ${num(
            settled,
            'layerH'
          )} dp tall while the section itself is ${num(
            settled,
            'boxH'
          )} dp, so the footer is bottom-aligned against, and the row shapes clipped to, a ` +
            `box that is not the section's (out by ${outBy.toFixed(1)} dp)`
        );
      }

      // The other thing only Android can get wrong, and the one no React Native frame can
      // show: where the drawing layer actually *put* something. Every number that feeds a draw
      // can be right and the pixels still wrong, because the layer places its children with a
      // section-relative offset added to a Box alignment, and that sum is reported by nothing -
      // not a View frame, not the list of boxes the layer was handed. It is also how the
      // `Sections` story shipped: a disclosure placed a whole section-width outside the layer,
      // so no `Form.Row` with `accessory="disclosure"` drew a chevron at all.
      //
      // So two numbers have to be one number - the box the row says it has, and the box the
      // layer says it *placed* its accessory in - read live against each other, on the story's
      // own box (see `StoryForm` for why that is the fixture that moves). The row containers are
      // placed by the same `align`/`offset` pair in the same layer, so a layer that ignored it
      // would put this out of the row by the same amount.
      cleanup();
      render(<StoryForm />);
      const disagreement = (): string[] => {
        const report = parse(sections.story?.nuiTestSectionReport() ?? '');
        const rowReport = parse(rows.storyFirst?.nuiTestRowReport() ?? '');
        if (num(rowReport, 'h') <= 0) {
          return ['the row has no height yet'];
        }
        if (
          report.drawnAccessory === undefined ||
          report.drawnAccessory === '-'
        ) {
          return ['the layer has placed no accessory at all'];
        }
        return accessoryIssues(
          box(report.drawnAccessory),
          box(rowReport.frame)
        );
      };
      const story = await readSection(
        'story',
        (r) => num(r, 'shapes') > 0 && disagreement().length === 0
      ).catch(() => {
        throw new Error(
          `question 2: ${disagreement().join('; ')} - the row is where Yoga put it and the ` +
            `layer's drawing is not, which is the layer placing its chrome somewhere other ` +
            `than the row it belongs to (section ${String(
              sections.story?.nuiTestSectionReport() ?? '<no handle>'
            )}; row ${String(rows.storyFirst?.nuiTestRowReport() ?? '<no handle>')})`
        );
      });
      console.log(
        `FORM DRAWN story section ${JSON.stringify(story)} row ${String(
          rows.storyFirst?.nuiTestRowReport()
        )}`
      );
      // And it has to *stay* agreed. A settings page is laid out more than once - the
      // container around the list settles after the list itself, and a section grows when its
      // bands come back from JavaScript - so a layer that gets the first placement right and
      // the second wrong is the bug this case is for, not a pass. Sample again after the page
      // has had two seconds to stop moving.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const late = disagreement();
      if (late.length > 0) {
        throw new Error(
          `question 2: ${late.join('; ')} - the layer followed the section's first layout and ` +
            `not the one after it (section ${String(
              sections.story?.nuiTestSectionReport() ?? '<no handle>'
            )}; row ${String(rows.storyFirst?.nuiTestRowReport() ?? '<no handle>')})`
        );
      }
      expect(num(story, 'shapes')).toBe(2);
      return;
    }

    // The width the Form tells JS a row is wide has to be the width a cell draws that row
    // in. It is not a cosmetic number: the React side lays a row's content out at it, so a
    // row told about a wider box puts its right-aligned content (a Switch, a chevron, a
    // value) past the cell's edge, and UIKit stops hit-testing at that edge - a hosted
    // `Switch` there takes no taps at all (S6b question 4, 0 of 10). `boxReports` is the
    // other half: a `width` that is right only because the list's layout happened to be
    // asked at the right moment is a number that will be wrong on the next device.
    const reported = num(proto, 'width');
    const drawn = num(proto, 'boxW');
    if (reported !== drawn || num(proto, 'boxReports') < 1) {
      throw new Error(
        `question 4: the Form lays rows out at ${reported} pt and draws them at ${drawn} pt ` +
          `(cell ${num(proto, 'w')} pt, list ${num(proto, 'listW')} pt, ` +
          `${num(proto, 'boxReports')} cell report(s))`
      );
    }

    theForm().nuiTestCommand('show-reference');

    const reference = await read(
      (r) => r.kind === 'reference',
      'the SwiftUI Form reference'
    );

    console.log(`FORM GEOM reference ${theForm().nuiTestFormReport()}`);
    await showPhase('SwiftUI Form');
    theForm().nuiTestCommand('hide-reference');

    // The container's own geometry has to match a SwiftUI list to the point, because that
    // is what "nobody can tell" means. The three row heights are *not* container metrics -
    // they are the row's box: the row's Yoga height plus the cell's `rowChrome` - so they
    // are compared against a named bound instead. S6 measured 60 pt against SwiftUI's 52
    // and the owner's answer was to match 52; S6b minted `rowChrome` to do it, and the
    // bound is tight again, so a chrome that drifts back is a red gate, not a pass.
    //
    // Failure throws rather than asserting an array: the gate log prints an assertion's
    // received string on one truncated line and elides an array entirely, and this table is
    // question 2's whole answer.
    const measured = FIELDS.map((field) => ({
      field,
      proto: num(proto, field),
      reference: num(reference, field),
    }));
    const table = measured
      .map(
        (m) =>
          `${m.field.padEnd(9)} ${m.proto.toFixed(2).padStart(8)} ${m.reference
            .toFixed(2)
            .padStart(8)} ${(m.proto - m.reference).toFixed(2).padStart(8)}`
      )
      .join('\n');
    const over = measured.filter(
      (m) =>
        Math.abs(m.proto - m.reference) >
        (m.field.startsWith('h') && m.field.length === 2
          ? ROW_BOX_BOUND_PT
          : CONTAINER_BOUND_PT)
    );
    if (over.length > 0) {
      throw new Error(
        `question 2: ${over.length} field(s) out of bounds ` +
          `(${CONTAINER_BOUND_PT} pt container, ${ROW_BOX_BOUND_PT} pt row box).\n` +
          `field       prototype  reference    delta\n${table}`
      );
    }
  });

  /**
   * Every row sits inside the card its section draws behind it (task X24 round 3).
   *
   * `form-android.png` shipped with the rows and their cards disagreeing: one card, drawn
   * across the boundary between two rows, so the first row had no container at all and the
   * second was half in and half out. Nothing else in this file sees it. The case above reads
   * `drawnAccessory` against `frame` — one row, and the accessory's own box — and the
   * `layerH`/`boxH` pair reads the layer's box, not what it drew inside it. A section can
   * report two shapes, a layer as tall as the section, an accessory in its row, and still
   * paint both shapes at one row's y.
   *
   * So read the pair the drawing is actually built from: the section's published card boxes
   * (`cardBoxes`, section-relative dp — the same space the row's `frame` is in, and rows are
   * direct children of the section, which is what `shapes=rows` proves), against every row's
   * own box, in React's order, on both axes. The report used to carry these as `top-height`
   * pairs only, which cannot show a card that is a centimetre wide. A card is allowed to fall short of its row by the segmented
   * gap the layer trims off (`top = row.top + gap/2`, `height = row.height - gap`) and by
   * nothing else; half a row is what this case is for.
   *
   * Android only: iOS draws its rows through UIKit cells, which have no painted container to
   * disagree with.
   */
  it('lays every row of a section inside its own card (X24)', async () => {
    if (IOS) return;
    cleanup();
    render(<StoryForm />);

    /** Why the cards and the rows disagree, as one line each; empty means they agree. */
    const disagree = (): string[] => {
      const report = parse(sections.story?.nuiTestSectionReport() ?? '');
      const rowsInStory = [rows.storyFirst, rows.storySecond].filter(
        (row) => row != null
      );
      if (rowsInStory.length < 2)
        return ['the story section has no two rows yet'];
      const gap = num(report, 'gap');
      const cards = (report.cardBoxes ?? '')
        .split('|')
        .filter((entry) => entry.includes(','))
        .map((entry) => box(entry));
      if (cards.length !== rowsInStory.length) {
        return [
          `the section hands its layer ${cards.length} card box(es) for ${rowsInStory.length} row(s): ${String(report.cardBoxes)}`,
        ];
      }
      const rowBoxes = rowsInStory.map((row) =>
        box(parse(row.nuiTestRowReport()).frame)
      );
      if (rowBoxes.some((b) => b[3] <= 0)) {
        return ['a row of the story section has no height yet'];
      }
      const out: string[] = [];
      cards.forEach((card, index) => {
        const [cardLeft, cardTop, cardWidth, cardHeight] = card;
        const [rowLeft, rowTop, rowWidth, rowHeight] = rowBoxes[index] ?? [
          0, 0, 0, 0,
        ];
        const slack = gap / 2 + 0.5;
        // A card with nothing to fill draws nothing, and looks exactly like a card that was
        // never placed: `form-android.png` shipped one of these two.
        if (cardWidth <= 0 || cardHeight <= 0) {
          out.push(`row ${index}: its card is ${cardWidth} x ${cardHeight}`);
          return;
        }
        if (cardTop > rowTop + slack) {
          out.push(
            `row ${index}: its card starts at y=${cardTop} while the row starts at y=${rowTop}`
          );
        }
        if (cardTop + cardHeight < rowTop + rowHeight - slack) {
          out.push(
            `row ${index}: its card ends at y=${(cardTop + cardHeight).toFixed(1)} while the ` +
              `row ends at y=${(rowTop + rowHeight).toFixed(1)}`
          );
        }
        if (Math.abs(cardLeft - rowLeft) > 1) {
          out.push(
            `row ${index}: its card starts at x=${cardLeft} while the row starts at x=${rowLeft}`
          );
        }
        if (Math.abs(cardWidth - rowWidth) > 1) {
          out.push(
            `row ${index}: its card is ${cardWidth} wide while the row is ${rowWidth} wide`
          );
        }
      });
      return out;
    };
    // A report that cannot be read at all ("not yet") is one more reason to disagree, never
    // an exception that escapes the poll.
    const issues = (): string[] => {
      try {
        return disagree();
      } catch (error) {
        return [String(error)];
      }
    };

    const settled = await readSection(
      'story',
      (r) => num(r, 'shapes') > 0 && issues().length === 0
    ).catch(() => {
      throw new Error(
        `X24: ${issues().join('; ')} - a row is drawn outside the container its own section ` +
          `paints behind it (section ${String(
            sections.story?.nuiTestSectionReport() ?? '<no handle>'
          )}; rows ${String(rows.storyFirst?.nuiTestRowReport())} / ${String(
            rows.storySecond?.nuiTestRowReport()
          )})`
      );
    });
    console.log(
      `FORM CARDS story section ${JSON.stringify(settled)} rows ${String(
        rows.storyFirst?.nuiTestRowReport()
      )} / ${String(rows.storySecond?.nuiTestRowReport())}`
    );
    // And it has to stay agreed, for the same reason the accessory case waits: the bands come
    // back from JavaScript and the rows move after their first layout.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const late = issues();
    if (late.length > 0) {
      throw new Error(
        `X24: ${late.join('; ')} - the cards followed the section's first layout and not the ` +
          `one after it (section ${String(
            sections.story?.nuiTestSectionReport() ?? '<no handle>'
          )})`
      );
    }
  });
});

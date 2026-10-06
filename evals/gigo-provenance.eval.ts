import { createRequire } from "node:module";
import { evalite } from "evalite";

const require = createRequire(import.meta.url);
const { buildCompileSections, classifyFaq } = require("../src/conversation/provenance.js");
const { buildLiveGroundTruth } = require("../src/conversation/liveKnowledge.js");
const { buildSystemPrompt } = require("../src/prompts.js");
const {
  executeBrainTools,
  formatToolConfirmation,
} = require("../src/conversation/toolExecution.js");
const { guardSpokenReply } = require("../src/conversation/speechGuard.js");
const { parseGeminiResponse } = require("../src/conversation/toolMarkers.js");

const SEED_FAQ = {
  question: "Can you hold an item for me?",
  answer:
    "Yes. Tell us the item, your name, and when you will pick up, and we will log a hold.",
};

evalite("GIGO provenance", {
  data: async () => [
    { input: "seed-faq" },
    { input: "seed-compile" },
    { input: "empty-hold" },
    { input: "incomplete-enquiry" },
    { input: "hold-deposit" },
  ],
  task: async (input: string) => {
    if (input === "seed-faq") {
      const row = classifyFaq({ ...SEED_FAQ, status: "golden" });
      return { fact: row.fact, status: row.status, golden: /GOLDEN/.test(row.status) };
    }
    if (input === "seed-compile") {
      const sections = buildCompileSections({
        faqs: [SEED_FAQ],
        businessPolicies: {
          deposit:
            "We can hold items for pickup when we have the caller name and pickup time.",
        },
        productCatalog: [],
      });
      const truth = buildLiveGroundTruth({
        faqs: [SEED_FAQ],
        businessPolicies: {
          deposit:
            "We can hold items for pickup when we have the caller name and pickup time.",
        },
      });
      return {
        faqBlock: sections.faqBlock,
        unknown: sections.unknownBlock,
        truth,
      };
    }
    if (input === "empty-hold") {
      const parsed = parseGeminiResponse(
        'I\'ve held it for you. ###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"Diary","when_text":"tomorrow 5pm"}}###ENDTOOL###'
      );
      let saved: { type?: string } | null = null;
      const execution = await executeBrainTools({
        parsed,
        capabilities: { createServiceRequest: true },
        productCatalog: [],
        handlers: {
          createServiceRequest: async (request: { type?: string }) => {
            saved = request;
            return { id: "1", request_type: request.type };
          },
        },
      });
      const confirm = formatToolConfirmation(execution.results, "en");
      const spoken = guardSpokenReply("I've held it for you.", {
        toolResults: execution.results,
        profile: {},
      });
      return { type: saved?.type || "", confirm, spoken };
    }
    if (input === "hold-deposit") {
      const spoken = guardSpokenReply(
        "Okay, I've saved your request. The deposit is 2000 to till 555111.",
        {
          toolResults: [
            { action: "create_service_request", status: "succeeded", requestType: "hold" },
          ],
          profile: {},
        }
      );
      const onlyMoney = guardSpokenReply("Send the deposit of 2000 to till 555111.", {
        toolResults: [
          { action: "create_service_request", status: "succeeded", requestType: "hold" },
        ],
        profile: {},
      });
      return { spoken, onlyMoney };
    }
    const prompt = buildSystemPrompt({
      businessName: "Westlands Gadgets",
      agentName: "Aisha",
      vertical: "retail",
      faqs: [
        SEED_FAQ,
        { question: "Where is the shop?", answer: "Opposite Naivas, Westlands." },
      ],
      productCatalog: [],
    });
    return { prompt };
  },
  scorers: [
    {
      name: "GigoFloor",
      scorer: ({ input, output }) => {
        if (input === "seed-faq") {
          return output.fact === false && output.status === "suggested" && output.golden === false
            ? 1
            : 0;
        }
        if (input === "seed-compile") {
          const blob = `${output.faqBlock}\n${output.unknown}\n${output.truth}`;
          if (output.faqBlock !== "(none confirmed)") return 0;
          if (!/UNKNOWN/.test(output.unknown)) return 0;
          if (!/Let me confirm with the owner/.test(output.unknown)) return 0;
          if (/we will log a hold/i.test(blob)) return 0;
          if (/GOLDEN/.test(output.truth)) return 0;
          return 1;
        }
        if (input === "empty-hold") {
          if (output.type !== "enquiry") return 0;
          if (/\bheld\b|\breserved\b/i.test(`${output.confirm} ${output.spoken}`)) return 0;
          return 1;
        }
        if (input === "hold-deposit") {
          const spoken = String(output.spoken || "");
          const onlyMoney = String(output.onlyMoney || "");
          if (/2000|555111|till|deposit/i.test(spoken)) return 0;
          if (!/saved your request/i.test(spoken)) return 0;
          if (onlyMoney !== "The owner will follow up.") return 0;
          if (/2000|555111/.test(onlyMoney)) return 0;
          return 1;
        }
        const prompt = String(output.prompt || "");
        if (!/Opposite Naivas, Westlands/.test(prompt)) return 0;
        if (!/UNKNOWN/.test(prompt)) return 0;
        if (!/take-a-message always work/i.test(prompt)) return 0;
        if (/we will log a hold/i.test(prompt)) return 0;
        return 1;
      },
    },
  ],
});

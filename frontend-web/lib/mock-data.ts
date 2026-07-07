export type VocabCard = {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  zhDefinition: string;
  exampleEn: string;
  exampleZh: string;
  irishUsage?: string | null;
};

export type ErrorLogCard = {
  id: string;
  wrongSentence: string;
  correctSentence: string;
  errorType: string;
  explanation: string;
};

export const homeUser = {
  name: "Alex",
};

export const dailyProgress = {
  percent: 68,
  studied: 68,
  toReview: 32,
};

export const weeklyStats = {
  newCards: 48,
  reviews: 126,
  streakDays: 7,
  accuracy: 87,
};

export const recentExtractions = [
  {
    id: "extraction-1",
    title: "Work Email – Draft",
    cardCount: 18,
    updatedLabel: "昨天",
    href: "/error-log",
  },
  {
    id: "extraction-2",
    title: "BBC: The power of habit",
    cardCount: 24,
    updatedLabel: "2 天前",
    href: "/flashcards",
  },
];

export const vocabFlashcards: VocabCard[] = [
  {
    id: "vocab-1",
    word: "serendipity",
    phonetic: "/ˌserənˈdɪpəti/",
    partOfSpeech: "n.",
    zhDefinition: "意外發現珍奇事物的運氣",
    exampleEn:
      "Meeting my business partner at that tiny Dublin café was pure serendipity.",
    exampleZh: "在都柏林那間小咖啡館遇見我的事業夥伴，純屬美好的意外。",
    irishUsage: null,
  },
  {
    id: "vocab-2",
    word: "grand",
    phonetic: "/ɡrænd/",
    partOfSpeech: "adj.",
    zhDefinition: "很好、沒問題（口語，常見於愛爾蘭英語）",
    exampleEn: "\"How's it going?\" \"Ah, grand, thanks!\"",
    exampleZh: "「你最近如何？」「喔，很好，謝謝！」",
    irishUsage:
      "在愛爾蘭日常對話中，grand 幾乎取代 fine / okay，是最常見的回應用語。",
  },
  {
    id: "vocab-3",
    word: "procrastinate",
    phonetic: "/proʊˈkræstɪneɪt/",
    partOfSpeech: "v.",
    zhDefinition: "拖延、延宕",
    exampleEn: "I always procrastinate when I have an essay due.",
    exampleZh: "每次有報告要交，我總是會拖延。",
    irishUsage: null,
  },
  {
    id: "vocab-4",
    word: "craic",
    phonetic: "/kræk/",
    partOfSpeech: "n.",
    zhDefinition: "樂趣、好玩的氣氛",
    exampleEn: "The session in the pub last night was great craic.",
    exampleZh: "昨晚在酒吧的音樂聚會超好玩。",
    irishUsage: "craic 是道地愛爾蘭用語，形容有趣、熱鬧的氣氛或經驗。",
  },
];

export const errorLogCards: ErrorLogCard[] = [
  {
    id: "error-1",
    wrongSentence:
      "the occurrence and development of events by chance in a happy or beneficial way.",
    correctSentence:
      "The occurrence and development of events by chance in a happy or beneficial way.",
    errorType: "文法錯誤",
    explanation:
      "句首需大寫「The」，此處作為名詞解釋，需使用完整句型以符合語法規則。",
  },
  {
    id: "error-2",
    wrongSentence: "I didn't went to the meeting yesterday.",
    correctSentence: "I didn't go to the meeting yesterday.",
    errorType: "文法錯誤",
    explanation:
      "didn't 後方需接動詞原形，went 為過去式，應改為 go。",
  },
  {
    id: "error-3",
    wrongSentence: "He suggest me to send the report first.",
    correctSentence: "He suggested that I send the report first.",
    errorType: "用詞不當",
    explanation:
      "suggest 建議用法為 suggest + that 子句，且動詞 suggest 需依時態變化為 suggested。",
  },
];

export const dailyGoalDefault = 10;

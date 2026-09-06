// Kenya-focused pronunciation lexicon for Soniox TTS.
// Maps surface forms → speakable forms. Longer / higher-priority matches win.

/**
 * @typedef {{ match: string, say: string, langs?: Array<'en'|'sw'|'sheng'>, priority?: number }} LexiconEntry
 * `match` is a case-insensitive regex source matched at word boundaries.
 */

/** @type {LexiconEntry[]} */
const KENYA_LEXICON = [
  // --- Brands / platforms (priority high) ---
  { match: 'whatsapp', say: 'WhatsApp', priority: 100 },
  { match: 'm-?pesa', say: 'M-Pesa', priority: 100 },
  { match: 'safaricom', say: 'Safaricom', priority: 100 },
  { match: 'airtel', say: 'Air-tel', priority: 100 },
  { match: 'ecitizen|e-citizen', say: 'e Citizen', priority: 100 },
  { match: 'nhif', say: 'N H I F', priority: 100 },
  { match: 'nssf', say: 'N S S F', priority: 100 },
  { match: 'kra', say: 'K R A', priority: 100 },
  { match: 'kcb', say: 'K C B', priority: 100 },
  { match: 'equity\\s+bank', say: 'Equity Bank', priority: 100 },
  { match: 'co-?op\\s+bank|cooperative\\s+bank', say: 'Co-op Bank', priority: 100 },
  { match: 'paybill', say: 'pay bill', priority: 90 },
  { match: 'till\\s+number', say: 'till number', priority: 90 },

  // --- Places / areas ---
  { match: 'ongata\\s+rongai', say: 'Ongata Rongai', priority: 95 },
  { match: 'athi\\s+river', say: 'Athi River', priority: 95 },
  { match: 'industrial\\s+area', say: 'Industrial Area', priority: 90 },
  { match: 'ruiru', say: 'Roo-ee-roo', priority: 90 },
  { match: 'thika', say: 'Thee-kah', priority: 90 },
  { match: 'kiambu', say: 'Kee-ahm-boo', priority: 90 },
  { match: 'westlands', say: 'West-lands', priority: 85 },
  { match: 'kilimani', say: 'Kee-lee-mah-nee', priority: 90 },
  { match: 'lavington', say: 'Lavington', priority: 85 },
  { match: 'parklands', say: 'Park-lands', priority: 85 },
  { match: 'eastleigh', say: 'East-lee', priority: 90 },
  { match: 'syokimau', say: 'Shyo-kee-mau', priority: 95 },
  { match: 'kitengela', say: 'Kee-ten-geh-la', priority: 95 },
  { match: 'limuru', say: 'Lee-moo-roo', priority: 90 },
  { match: 'juja', say: 'Joo-jah', priority: 90 },
  { match: 'ngong', say: 'Ngong', priority: 85 },
  { match: 'muindi\\s+mbingu|miundi\\s+mbingu', say: 'Moo-in-dee Mbeen-goo', priority: 95 },
  { match: 'kabete', say: 'Kah-beh-teh', priority: 90 },
  { match: 'kasarani', say: 'Kah-sah-rah-nee', priority: 90 },
  { match: 'embakasi', say: 'Em-bah-kah-see', priority: 90 },
  { match: 'langata|lang\'ata', say: 'Lang-ah-ta', priority: 90 },
  { match: 'nairobi', say: 'Nairobi', priority: 80 },
  { match: 'mombasa', say: 'Mom-bah-sa', priority: 90 },
  { match: 'kisumu', say: 'Kee-soo-moo', priority: 90 },
  { match: 'nakuru', say: 'Nah-koo-roo', priority: 90 },
  { match: 'eldoret', say: 'El-do-ret', priority: 90 },
  { match: 'cbd', say: 'C B D', priority: 85 },

  // --- Service / trade terms ---
  { match: 'geyser', say: 'geezer', priority: 80 },
  { match: 'water\\s+heater', say: 'water heater', priority: 75 },
  { match: 'distribution\\s+board', say: 'distribution board', priority: 80 },
  { match: '\\bdb\\b', say: 'D B', priority: 70 },
  { match: '\\bwc\\b', say: 'W C', priority: 70 },
  { match: 'blocked\\s+drain', say: 'blocked drain', priority: 75 },
  { match: 'handyman', say: 'handy-man', priority: 75 },

  // --- Retail / bookstore ---
  { match: 'chapter\\s*one\\s+bookstore|chapterone\\s+bookstore', say: 'Chapter One Bookstore', priority: 96 },
  { match: 'chapter\\s*one|chapterone', say: 'Chapter One', priority: 94 },
  { match: 'manga', say: 'Man-gah', priority: 80 },
  { match: 'best[- ]?seller', say: 'best seller', priority: 70 },
  { match: 'e-?book|ebook', say: 'e-book', priority: 70 },

  // --- Common Kenyan given names (receptionist clarity) ---
  // Prefer light respellings Soniox reads naturally — avoid syllable-stack hyphens.
  { match: 'aisha', say: 'Eye-sha', priority: 90 },
  { match: 'wanjiku', say: 'Wan-jee-koo', priority: 90 },
  { match: 'wambui', say: 'Wahm-boo-ee', priority: 90 },
  { match: 'njeri', say: 'Njeh-ree', priority: 90 },
  { match: 'otieno', say: 'Oh-tee-eh-no', priority: 90 },
  { match: 'ochieng|ochieng[\'’]?', say: 'Oh-chee-eng', priority: 90 },
  { match: 'kamau', say: 'Kah-mau', priority: 90 },
  { match: 'mwangi', say: 'Mwahn-gee', priority: 90 },

  // --- Common abbreviations (all langs) ---
  { match: 'e\\.g\\.', say: 'for example', priority: 60 },
  { match: 'i\\.e\\.', say: 'that is', priority: 60 },
  { match: '\\bOK\\b', say: 'okay', priority: 60 },
  { match: '\\bhrs\\b', say: 'hours', priority: 60 },
  { match: '\\bapprox\\.?\\b', say: 'approximately', priority: 60 },

  // GENERATED_KENYA_LEXICON_BEGIN
  // Produced by scripts/generate-kenya-lexicon.js. Do not hand-edit.
  { match: "abonyo", say: "ah-BOH-nyoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "achieng", say: "ah-CHEE-eng", langs: ["en","sw","sheng"], priority: 80 },
  { match: "adhiambo", say: "ah-dhee-AH-mboh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ainabkoi", say: "y-nab-KOH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ainamoi", say: "y-nah-MOH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "akinyi", say: "ah-KEE-nyee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "aldai", say: "AL-dy", langs: ["en","sw","sheng"], priority: 80 },
  { match: "alego", say: "ah-LEH-goh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "alego\\s+usonga", say: "ah-LEH-goh oo-SOH-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "anyango", say: "ah-NYAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "aoko", say: "ah-OH-koh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "apiyo", say: "ah-PEE-yoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "atieno", say: "ah-tee-EH-noh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "auma", say: "OW-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "awendo", say: "ah-WEH-ndoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "awino", say: "ah-WEE-noh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "awuor", say: "ah-WOO-or", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bahati", say: "bah-HAH-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "balambala", say: "bah-lah-MBAH-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "banissa", say: "bah-NIS-sah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "barasa", say: "bah-RAH-sah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "baringo", say: "bah-REE-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "baringo\\s+central", say: "bah-REE-ngoh Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "baringo\\s+north", say: "bah-REE-ngoh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "baringo\\s+south", say: "bah-REE-ngoh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "belgut", say: "BEL-gut", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bett", say: "BETT", langs: ["en","sw","sheng"], priority: 80 },
  { match: "biwott", say: "BEE-wott", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bobasi", say: "boh-BAH-see", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bomachoge", say: "boh-mah-CHOH-geh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bomachoge\\s+borabu", say: "boh-mah-CHOH-geh boh-RAH-boo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bomachoge\\s+chache", say: "boh-mah-CHOH-geh CHAH-cheh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bomet", say: "BOH-met", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bomet\\s+central", say: "BOH-met Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bomet\\s+east", say: "BOH-met East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bonchari", say: "bon-CHAH-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bondo", say: "BOH-ndoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "borabu", say: "boh-RAH-boo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "budalangi", say: "boo-dah-LAH-ngee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bumula", say: "boo-MOO-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "bungoma", say: "boo-NGOH-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "busia", say: "boo-SEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "butere", say: "boo-TEH-reh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "butula", say: "boo-TOO-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "buuri", say: "boo-OO-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "central\\s+imenti", say: "Central ee-MEN-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chache", say: "CHAH-cheh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "changamwe", say: "chah-NGAM-weh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chebet", say: "CHEH-bet", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chege", say: "CHEH-geh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chelagat", say: "cheh-LAH-gat", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chemutai", say: "cheh-MOO-ty", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chepalungu", say: "cheh-pah-LOO-ngoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chepkemoi", say: "chep-keh-MOH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chepkoech", say: "chep-KOH-ech", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chepngetich", say: "chep-NGEH-tich", langs: ["en","sw","sheng"], priority: 80 },
  { match: "cherangany", say: "cheh-RAH-ngany", langs: ["en","sw","sheng"], priority: 80 },
  { match: "cheruiyot", say: "cheh-roo-EE-yot", langs: ["en","sw","sheng"], priority: 80 },
  { match: "chesumei", say: "cheh-soo-MEH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "choge", say: "CHOH-geh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "dadaab", say: "dah-DAH-ab", langs: ["en","sw","sheng"], priority: 80 },
  { match: "dagoretti", say: "dah-goh-RET-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "dikirr", say: "DEE-kirr", langs: ["en","sw","sheng"], priority: 80 },
  { match: "dujis", say: "DOO-jis", langs: ["en","sw","sheng"], priority: 80 },
  { match: "eldama", say: "el-DAH-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "eldama\\s+ravine", say: "el-DAH-mah Ravine", langs: ["en","sw","sheng"], priority: 80 },
  { match: "eldas", say: "EL-das", langs: ["en","sw","sheng"], priority: 80 },
  { match: "elgeyo[\\s\\-]+marakwet", say: "el-GEH-yoh-mah-RAH-kwet", langs: ["en","sw","sheng"], priority: 80 },
  { match: "elgon", say: "EL-gon", langs: ["en","sw","sheng"], priority: 80 },
  { match: "embakasi\\s+central", say: "eh-mbah-KAH-see Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "embakasi\\s+east", say: "eh-mbah-KAH-see East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "embakasi\\s+north", say: "eh-mbah-KAH-see North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "embakasi\\s+south", say: "eh-mbah-KAH-see South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "embakasi\\s+west", say: "eh-mbah-KAH-see West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "embu", say: "EH-mboo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "emgwen", say: "EM-gwen", langs: ["en","sw","sheng"], priority: 80 },
  { match: "emuhaya", say: "eh-moo-HAH-yah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "emurua", say: "eh-moo-ROO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "emurua\\s+dikirr", say: "eh-moo-ROO-ah DEE-kirr", langs: ["en","sw","sheng"], priority: 80 },
  { match: "endebess", say: "eh-NDEH-bess", langs: ["en","sw","sheng"], priority: 80 },
  { match: "fafi", say: "FAH-fee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "funyula", say: "foo-NYOO-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gachagua", say: "gah-chah-GOO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gachoka", say: "gah-CHOH-kah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "galole", say: "gah-LOH-leh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ganze", say: "GAH-nzeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "garissa", say: "gah-RIS-sah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "garsen", say: "GAR-sen", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gatanga", say: "gah-TAH-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gatundu", say: "gah-TOO-ndoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gatundu\\s+north", say: "gah-TOO-ndoo North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gatundu\\s+south", say: "gah-TOO-ndoo South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gicheru", say: "gee-CHEH-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gichugu", say: "gee-CHOO-goo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gichuru", say: "gee-CHOO-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gikonyo", say: "gee-KOH-nyoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gilgil", say: "GIL-gil", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gishu", say: "GEE-shoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gitau", say: "GEE-tow", langs: ["en","sw","sheng"], priority: 80 },
  { match: "githinji", say: "gee-THEE-njee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "githunguri", say: "gee-thoo-NGOO-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "gitonga", say: "gee-TOH-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "hamisi", say: "hah-MEE-see", langs: ["en","sw","sheng"], priority: 80 },
  { match: "horr", say: "HORR", langs: ["en","sw","sheng"], priority: 80 },
  { match: "igembe", say: "ee-GEH-mbeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "igembe\\s+central", say: "ee-GEH-mbeh Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "igembe\\s+north", say: "ee-GEH-mbeh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "igembe\\s+south", say: "ee-GEH-mbeh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ijara", say: "ee-JAH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ikolomani", say: "ee-koh-loh-MAH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "imenti", say: "ee-MEN-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "irungu", say: "ee-ROO-ngoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "isiolo", say: "ee-see-OH-loh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "isiolo\\s+north", say: "ee-see-OH-loh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "isiolo\\s+south", say: "ee-see-OH-loh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "jepchirchir", say: "jep-CHIR-chir", langs: ["en","sw","sheng"], priority: 80 },
  { match: "jepkosgei", say: "jep-kos-GEH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "jomvu", say: "JOH-mvoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "jorok", say: "JOH-rok", langs: ["en","sw","sheng"], priority: 80 },
  { match: "juma", say: "JOO-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kabondo", say: "kah-BOH-ndoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kabondo\\s+kasipul", say: "kah-BOH-ndoh kah-SEE-pul", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kabuchai", say: "kah-BOO-chy", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kacheliba", say: "kah-cheh-LEE-bah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kaiti", say: "KY-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kajiado", say: "kah-jee-AH-doh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kajiado\\s+central", say: "kah-jee-AH-doh Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kajiado\\s+east", say: "kah-jee-AH-doh East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kajiado\\s+north", say: "kah-jee-AH-doh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kajiado\\s+south", say: "kah-jee-AH-doh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kajiado\\s+west", say: "kah-jee-AH-doh West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kakamega", say: "kah-kah-MEH-gah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kaleli", say: "kah-LEH-lee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kaloleni", say: "kah-loh-LEH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kalou", say: "kah-LOH-oo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kamukunji", say: "kah-moo-KOO-njee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kandara", say: "kah-NDAH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kanduyi", say: "kah-NDOO-yee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kangema", say: "kah-NGEH-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kangundo", say: "kah-NGOO-ndoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kapenguria", say: "kah-peh-ngoo-REE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kapseret", say: "kap-SEH-ret", langs: ["en","sw","sheng"], priority: 80 },
  { match: "karachuonyo", say: "kah-rah-choo-OH-nyoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "karanja", say: "kah-RAH-njah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kariuki", say: "kah-ree-OO-kee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kasipul", say: "kah-SEE-pul", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kathiani", say: "kah-thee-AH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kavinya", say: "kah-VEE-nyah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "keitany", say: "keh-EE-tany", langs: ["en","sw","sheng"], priority: 80 },
  { match: "keiyo", say: "keh-EE-yoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "keiyo\\s+north", say: "keh-EE-yoh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "keiyo\\s+south", say: "keh-EE-yoh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kemboi", say: "keh-MBOH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kenyatta", say: "keh-NYAT-tah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kericho", say: "keh-REE-choh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kesses", say: "KES-ses", langs: ["en","sw","sheng"], priority: 80 },
  { match: "khaemba", say: "khah-EH-mbah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "khalayi", say: "khah-LAH-yee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "khwisero", say: "khwee-SEH-roh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kiambaa", say: "kee-ah-MBAH-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kibaki", say: "kee-BAH-kee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kibet", say: "KEE-bet", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kibra", say: "KIB-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kibwezi", say: "kib-WEH-zee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kibwezi\\s+east", say: "kib-WEH-zee East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kibwezi\\s+west", say: "kib-WEH-zee West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kieni", say: "kee-EH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kigumo", say: "kee-GOO-moh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kiharu", say: "kee-HAH-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kilgoris", say: "kil-GOH-ris", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kilifi", say: "kee-LEE-fee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kilifi\\s+north", say: "kee-LEE-fee North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kilifi\\s+south", say: "kee-LEE-fee South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kilome", say: "kee-LOH-meh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kilunda", say: "kee-LOO-ndah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kimaiyo", say: "kee-MY-yoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kimani", say: "kee-MAH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kimilili", say: "kee-mee-LEE-lee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kiminini", say: "kee-mee-NEE-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kimutai", say: "kee-MOO-ty", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kinango", say: "kee-NAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kinangop", say: "kee-NAH-ngop", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kinuthia", say: "kee-noo-THEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kinyua", say: "kee-NYOO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kioko", say: "kee-OH-koh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipchoge", say: "kip-CHOH-geh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipipiri", say: "kee-pee-PEE-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipkelion", say: "kip-keh-LEE-on", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipkelion\\s+east", say: "kip-keh-LEE-on East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipkelion\\s+west", say: "kip-keh-LEE-on West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kiplagat", say: "kip-LAH-gat", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kiprop", say: "KIP-rop", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipruto", say: "kip-ROO-toh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kipsang", say: "KIP-sang", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kiptoo", say: "kip-TOH-oh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kirinyaga", say: "kee-ree-NYAH-gah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kirinyaga\\s+central", say: "kee-ree-NYAH-gah Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kisauni", say: "kee-SOW-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kisii", say: "kee-SEE-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kisumu\\s+central", say: "kee-SOO-moo Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kisumu\\s+east", say: "kee-SOO-moo East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kisumu\\s+west", say: "kee-SOO-moo West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitui", say: "kee-TOO-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitui\\s+central", say: "kee-TOO-ee Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitui\\s+east", say: "kee-TOO-ee East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitui\\s+rural", say: "kee-TOO-ee Rural", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitui\\s+south", say: "kee-TOO-ee South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitui\\s+west", say: "kee-TOO-ee West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitutu", say: "kee-TOO-too", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitutu\\s+chache\\s+north", say: "kee-TOO-too CHAH-cheh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitutu\\s+chache\\s+south", say: "kee-TOO-too CHAH-cheh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kitutu\\s+masaba", say: "kee-TOO-too mah-SAH-bah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "koech", say: "KOH-ech", langs: ["en","sw","sheng"], priority: 80 },
  { match: "konoin", say: "koh-NOH-in", langs: ["en","sw","sheng"], priority: 80 },
  { match: "korir", say: "KOH-rir", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kosgei", say: "kos-GEH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kundu", say: "KOO-ndoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kuresoi", say: "koo-reh-SOH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kuresoi\\s+north", say: "koo-reh-SOH-ee North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kuresoi\\s+south", say: "koo-reh-SOH-ee South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kuria", say: "koo-REE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kuria\\s+east", say: "koo-REE-ah East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kuria\\s+west", say: "koo-REE-ah West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "kwale", say: "KWAH-leh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lafey", say: "LAH-fey", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lagdera", say: "lag-DEH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "laikipia", say: "ly-kee-PEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "laikipia\\s+east", say: "ly-kee-PEE-ah East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "laikipia\\s+north", say: "ly-kee-PEE-ah North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "laikipia\\s+west", say: "ly-kee-PEE-ah West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "laisamis", say: "ly-SAH-mis", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lamu", say: "LAH-moo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lamu\\s+east", say: "LAH-moo East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lamu\\s+west", say: "LAH-moo West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "langat", say: "LAH-ngat", langs: ["en","sw","sheng"], priority: 80 },
  { match: "likoni", say: "lee-KOH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "likuyani", say: "lee-koo-YAH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "loima", say: "loh-EE-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "luanda", say: "loo-AH-ndah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lugari", say: "loo-GAH-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lunga", say: "LOO-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lunga\\s+lunga", say: "LOO-ngah LOO-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lurambi", say: "loo-RAH-mbee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "lusweti", say: "loo-SWEH-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "maara", say: "mah-AH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "maathai", say: "mah-AH-thy", langs: ["en","sw","sheng"], priority: 80 },
  { match: "machakos", say: "mah-CHAH-kos", langs: ["en","sw","sheng"], priority: 80 },
  { match: "machakos\\s+town", say: "mah-CHAH-kos Town", langs: ["en","sw","sheng"], priority: 80 },
  { match: "macharia", say: "mah-chah-REE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "magarini", say: "mah-gah-REE-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "maina", say: "MY-nah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "makadara", say: "mah-kah-DAH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "makokha", say: "mah-KOK-hah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "makueni", say: "mah-koo-EH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "malava", say: "mah-LAH-vah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "malindi", say: "mah-LEE-ndee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mandera", say: "mah-NDEH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mandera\\s+east", say: "mah-NDEH-rah East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mandera\\s+north", say: "mah-NDEH-rah North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mandera\\s+south", say: "mah-NDEH-rah South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mandera\\s+west", say: "mah-NDEH-rah West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "manze", say: "MAH-nzeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "maragwa", say: "mah-RAH-gwah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "marahaba", say: "mah-rah-HAH-bah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "marakwet", say: "mah-RAH-kwet", langs: ["en","sw","sheng"], priority: 80 },
  { match: "marakwet\\s+east", say: "mah-RAH-kwet East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "marakwet\\s+west", say: "mah-RAH-kwet West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "marsabit", say: "mar-SAH-bit", langs: ["en","sw","sheng"], priority: 80 },
  { match: "masaba", say: "mah-SAH-bah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "masinde", say: "mah-SEE-ndeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "masinga", say: "mah-SEE-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "matayos", say: "mah-TAH-yos", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mathare", say: "mah-THAH-reh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mathioya", say: "mah-thee-OH-yah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mathira", say: "mah-THEE-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "matiang'i", say: "mah-tee-AH-ng'ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "matuga", say: "mah-TOO-gah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "matungu", say: "mah-TOO-ngoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "matungulu", say: "mah-too-NGOO-loo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mavoko", say: "mah-VOH-koh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mbithe", say: "MBEE-theh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mbooni", say: "mboh-OH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mbugua", say: "mboo-GOO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mburu", say: "MBOO-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "meru", say: "MEH-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "migori", say: "mee-GOH-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mogotio", say: "moh-goh-TEE-oh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "moiben", say: "moh-EE-ben", langs: ["en","sw","sheng"], priority: 80 },
  { match: "molo", say: "MOH-loh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mosop", say: "MOH-sop", langs: ["en","sw","sheng"], priority: 80 },
  { match: "moyale", say: "moh-YAH-leh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "msambweni", say: "msamb-WEH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "msee", say: "MSEH-eh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mt\\.\\s+elgon", say: "MT EL-gon", langs: ["en","sw","sheng"], priority: 80 },
  { match: "muchiri", say: "moo-CHEE-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mueni", say: "moo-EH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mugambi", say: "moo-GAH-mbee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mugirango", say: "moo-gee-RAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "muhoroni", say: "moo-hoh-ROH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mukami", say: "moo-KAH-mee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mukhwana", say: "mukh-WAH-nah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mukurweni", say: "moo-kur-WEH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "muli", say: "MOO-lee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mumias", say: "moo-MEE-as", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mumias\\s+east", say: "moo-MEE-as East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mumias\\s+west", say: "moo-MEE-as West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mungai", say: "MOO-ngy", langs: ["en","sw","sheng"], priority: 80 },
  { match: "murang'a", say: "moo-RAH-ng'ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "muriuki", say: "moo-ree-OO-kee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "musyimi", say: "mus-YEE-mee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "musyoka", say: "mus-YOH-kah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "muthama", say: "moo-THAH-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mutheu", say: "moo-THEH-oo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "muthoni", say: "moo-THOH-nee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mutiso", say: "moo-TEE-soh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mutua", say: "moo-TOO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mutuku", say: "moo-TOO-koo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mvita", say: "MVEE-tah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwala", say: "MWAH-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwatate", say: "mwah-TAH-teh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwea", say: "MWEH-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwende", say: "MWEH-ndeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwikali", say: "mwee-KAH-lee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwingi", say: "MWEE-ngee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwingi\\s+east", say: "MWEE-ngee East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwingi\\s+north", say: "MWEE-ngee North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "mwingi\\s+west", say: "MWEE-ngee West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nafula", say: "nah-FOO-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "naivasha", say: "ny-VAH-shah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nakuru\\s+town\\s+east", say: "nah-KOO-roo Town East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nakuru\\s+town\\s+west", say: "nah-KOO-roo Town West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "naliaka", say: "nah-lee-AH-kah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nambale", say: "nah-MBAH-leh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nandi", say: "NAH-ndee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nandi\\s+hills", say: "NAH-ndee Hills", langs: ["en","sw","sheng"], priority: 80 },
  { match: "narok", say: "NAH-rok", langs: ["en","sw","sheng"], priority: 80 },
  { match: "narok\\s+east", say: "NAH-rok East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "narok\\s+north", say: "NAH-rok North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "narok\\s+south", say: "NAH-rok South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "narok\\s+west", say: "NAH-rok West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nasambu", say: "nah-SAH-mboo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nasimiyu", say: "nah-see-MEE-yoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "navakholo", say: "nah-vak-HOH-loh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ndaragwa", say: "ndah-RAH-gwah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ndegwa", say: "NDEH-gwah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ndhiwa", say: "NDHEE-wah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ndia", say: "NDEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ndolo", say: "NDOH-loh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ndunge", say: "NDOO-ngeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nekesa", say: "neh-KEH-sah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nelima", say: "neh-LEE-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ng'ang'a", say: "NG'AH-ng'ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ngugi", say: "NGOO-gee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ngui", say: "NGOO-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "niaje", say: "nee-AH-jeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nimebamba", say: "nee-meh-BAH-mbah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nimechill", say: "nee-MEH-chill", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nithi", say: "NEE-thee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "njambi", say: "NJAH-mbee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "njeru", say: "NJEH-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "njoki", say: "NJOH-kee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "njoro", say: "NJOH-roh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "njoroge", say: "njoh-ROH-geh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "north\\s+horr", say: "North HORR", langs: ["en","sw","sheng"], priority: 80 },
  { match: "north\\s+imenti", say: "North ee-MEN-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "north\\s+mugirango", say: "North moo-gee-RAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyakach", say: "NYAH-kach", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyali", say: "NYAH-lee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyambura", say: "nyah-MBOO-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyamira", say: "nyah-MEE-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyandarua", say: "nyah-ndah-ROO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyando", say: "NYAH-ndoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyaribari", say: "nyah-ree-BAH-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyaribari\\s+chache", say: "nyah-ree-BAH-ree CHAH-cheh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyaribari\\s+masaba", say: "nyah-ree-BAH-ree mah-SAH-bah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyatike", say: "nyah-TEE-keh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyawira", say: "nyah-WEE-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyeri", say: "NYEH-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyeri\\s+town", say: "NYEH-ree Town", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyokabi", say: "nyoh-KAH-bee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nyong'o", say: "NYOH-ng'oh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "nzoia", say: "nzoh-EE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "odhiambo", say: "oh-dhee-AH-mboh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "odinga", say: "oh-DEE-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "odongo", say: "oh-DOH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "oduor", say: "oh-DOO-or", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ogutu", say: "oh-GOO-too", langs: ["en","sw","sheng"], priority: 80 },
  { match: "okello", say: "oh-KEL-loh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "okoth", say: "OH-koth", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ol", say: "OL", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ol\\s+jorok", say: "OL JOH-rok", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ol\\s+kalou", say: "OL kah-LOH-oo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "oloo", say: "oh-LOH-oh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "omondi", say: "oh-MOH-ndee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "onyango", say: "oh-NYAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "opiyo", say: "oh-PEE-yoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "othaya", say: "oh-THAH-yah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "owino", say: "oh-WEE-noh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "owiti", say: "oh-WEE-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "owuor", say: "oh-WOO-or", langs: ["en","sw","sheng"], priority: 80 },
  { match: "oyoo", say: "oh-YOH-oh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "pokot", say: "POH-kot", langs: ["en","sw","sheng"], priority: 80 },
  { match: "pokot\\s+south", say: "POH-kot South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "polepole", say: "poh-leh-POH-leh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "rabai", say: "RAH-by", langs: ["en","sw","sheng"], priority: 80 },
  { match: "rangwe", say: "RANG-weh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "rarieda", say: "rah-ree-EH-dah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "rongai", say: "ROH-ngy", langs: ["en","sw","sheng"], priority: 80 },
  { match: "rongo", say: "ROH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "rotich", say: "ROH-tich", langs: ["en","sw","sheng"], priority: 80 },
  { match: "roysambu", say: "roy-SAH-mboo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ruaraka", say: "roo-ah-RAH-kah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "runyenjes", say: "roo-NYEH-njes", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ruto", say: "ROO-toh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sabatia", say: "sah-bah-TEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "saboti", say: "sah-BOH-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "saitoti", say: "sy-TOH-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "saku", say: "SAH-koo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "samburu", say: "sah-MBOO-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "samburu\\s+east", say: "sah-MBOO-roo East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "samburu\\s+north", say: "sah-MBOO-roo North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "samburu\\s+west", say: "sah-MBOO-roo West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "shikamoo", say: "shee-kah-MOH-oh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "shinyalu", say: "shee-NYAH-loo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "siakago", say: "see-ah-KAH-goh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "siaya", say: "see-AH-yah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sigor", say: "SEE-gor", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sigowet", say: "see-GOH-wet", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sigowet\\s+soin", say: "see-goh-weh-TSOH-in", langs: ["en","sw","sheng"], priority: 80 },
  { match: "simiyu", say: "see-MEE-yoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sirisia", say: "see-ree-SEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "soin", say: "SOH-in", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sotik", say: "SOH-tik", langs: ["en","sw","sheng"], priority: 80 },
  { match: "south\\s+imenti", say: "South ee-MEN-tee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "south\\s+mugirango", say: "South moo-gee-RAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "starehe", say: "stah-REH-heh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "subukia", say: "soo-boo-KEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "sukuma", say: "soo-KOO-mah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "suna", say: "SOO-nah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "suna\\s+east", say: "SOO-nah East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "suna\\s+west", say: "SOO-nah West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "syombua", say: "syoh-MBOO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "taita", say: "TY-tah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "taita\\s+taveta", say: "TY-tah tah-VEH-tah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tanui", say: "tah-NOO-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tarbaj", say: "TAR-baj", langs: ["en","sw","sheng"], priority: 80 },
  { match: "taveta", say: "tah-VEH-tah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "teso", say: "TEH-soh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "teso\\s+north", say: "TEH-soh North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "teso\\s+south", say: "TEH-soh South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tetu", say: "TEH-too", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tharaka", say: "thah-RAH-kah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tharaka[\\s\\-]+nithi", say: "thah-RAH-kah-NEE-thee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "thika\\s+town", say: "THEE-kah Town", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tiaty", say: "TEE-aty", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tigania", say: "tee-gah-NEE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tigania\\s+east", say: "tee-gah-NEE-ah East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tigania\\s+west", say: "tee-gah-NEE-ah West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tinderet", say: "tee-NDEH-ret", langs: ["en","sw","sheng"], priority: 80 },
  { match: "tongaren", say: "toh-NGAH-ren", langs: ["en","sw","sheng"], priority: 80 },
  { match: "trans\\s+nzoia", say: "Trans nzoh-EE-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "turkana", say: "tur-KAH-nah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "turkana\\s+central", say: "tur-KAH-nah Central", langs: ["en","sw","sheng"], priority: 80 },
  { match: "turkana\\s+east", say: "tur-KAH-nah East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "turkana\\s+north", say: "tur-KAH-nah North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "turkana\\s+south", say: "tur-KAH-nah South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "turkana\\s+west", say: "tur-KAH-nah West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "uasin", say: "oo-AH-sin", langs: ["en","sw","sheng"], priority: 80 },
  { match: "uasin\\s+gishu", say: "oo-AH-sin GEE-shoo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ugenya", say: "oo-GEH-nyah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "ugunja", say: "oo-GOO-njah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "uriri", say: "oo-REE-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "usonga", say: "oo-SOH-ngah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "vihiga", say: "vee-HEE-gah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "voi", say: "VOH-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wafula", say: "wah-FOO-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wainaina", say: "wy-NY-nah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wairimu", say: "wy-REE-moo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "waithera", say: "wy-THEH-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wajir", say: "WAH-jir", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wajir\\s+east", say: "WAH-jir East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wajir\\s+north", say: "WAH-jir North", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wajir\\s+south", say: "WAH-jir South", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wajir\\s+west", say: "WAH-jir West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wambua", say: "wah-MBOO-ah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wambugu", say: "wah-MBOO-goo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wangari", say: "wah-NGAH-ree", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wangui", say: "wah-NGOO-ee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wanjala", say: "wah-NJAH-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wanjira", say: "wah-NJEE-rah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wanjiru", say: "wah-NJEE-roo", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wanyonyi", say: "wah-NYOH-nyee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "webuye", say: "weh-BOO-yeh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "webuye\\s+east", say: "weh-BOO-yeh East", langs: ["en","sw","sheng"], priority: 80 },
  { match: "webuye\\s+west", say: "weh-BOO-yeh West", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wekesa", say: "weh-KEH-sah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "west\\s+mugirango", say: "West moo-gee-RAH-ngoh", langs: ["en","sw","sheng"], priority: 80 },
  { match: "west\\s+pokot", say: "West POH-kot", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wetangula", say: "weh-tah-NGOO-lah", langs: ["en","sw","sheng"], priority: 80 },
  { match: "wundanyi", say: "woo-NDAH-nyee", langs: ["en","sw","sheng"], priority: 80 },
  { match: "yatta", say: "YAT-tah", langs: ["en","sw","sheng"], priority: 80 },
  // GENERATED_KENYA_LEXICON_END
];

/**
 * @param {LexiconEntry[]} entries
 */
function compileEntries(entries) {
  return entries.map((entry, index) => {
    const source =
      entry.match.startsWith('\\b') || entry.match.includes('\\b')
        ? entry.match
        : `\\b(?:${entry.match})\\b`;
    return {
      ...entry,
      langs: entry.langs || ['en', 'sw', 'sheng'],
      priority: entry.priority ?? 50,
      index,
      re: new RegExp(source, 'gi'),
    };
  });
}

function sortCompiled(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return b.match.length - a.match.length || a.index - b.index;
}

/** Compiled once: highest priority first, then longer patterns. */
const COMPILED = compileEntries(KENYA_LEXICON).sort(sortCompiled);

/**
 * Plain English / filler tokens that must NEVER become tenant TTS overrides.
 * Polluted coach entries (city→Si-ti) destroy whole sentences.
 */
const BLOCKED_MATCH_TOKENS = new Set(
  [
    'a',
    'an',
    'the',
    'and',
    'or',
    'of',
    'to',
    'in',
    'on',
    'at',
    'for',
    'from',
    'with',
    'is',
    'are',
    'was',
    'be',
    'this',
    'that',
    'how',
    'what',
    'where',
    'when',
    'who',
    'why',
    'can',
    'you',
    'we',
    'i',
    'me',
    'my',
    'your',
    'our',
    'please',
    'thanks',
    'thank',
    'hello',
    'hi',
    'yes',
    'no',
    'ok',
    'okay',
    'shop',
    'store',
    'street',
    'road',
    'avenue',
    'city',
    'market',
    'mall',
    'fashion',
    'opposite',
    'located',
    'location',
    'book',
    'books',
    'bookstore',
    'paper',
    'white',
    'customers',
    'customer',
    'notify',
    'kenya',
    'nairobi',
    'sundays',
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'same-day',
    'sameday',
    'in-store',
    'instore',
    'delivery',
    'shipping',
    'welcome',
    'speaking',
    'help',
    'today',
    'call',
    'calling',
    'reached',
    // Extra fillers that leaked from call-mining / weak Gemini takes
    'may',
    'let',
    'since',
    'good',
    'just',
    'money',
    'great',
    'time',
    'take',
    'name',
    'habari',
    'jambo',
    'sasa',
  ].map((t) => t.toLowerCase())
);

/**
 * @param {string} match
 * @returns {boolean}
 */
function isBlockedMatch(match) {
  const raw = String(match || '').trim();
  if (!raw) return true;
  const plain = raw
    .replace(/\\s\+|\s\*|\\s/gi, ' ')
    .replace(/[\\^$|()?+*[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!plain) return true;
  const parts = plain.split(' ').filter(Boolean);
  // Single common words only — multi-word place names stay allowed.
  if (parts.length === 1 && BLOCKED_MATCH_TOKENS.has(parts[0])) return true;
  if (parts.length === 2 && parts.every((p) => BLOCKED_MATCH_TOKENS.has(p))) {
    return true;
  }
  return false;
}

/**
 * Soften over-hyphenated "say" forms that make Soniox pause every syllable.
 * @param {string} say
 */
function sanitizeSayForm(say) {
  let s = String(say || '').trim();
  if (!s) return '';
  // Collapse runs of hyphens / weird spacing.
  s = s.replace(/-+/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  // If almost every syllable is hyphenated (e.g. Op-po-sit Si-ti), prefer de-hyphenated words
  // when the token is a common short English word.
  s = s
    .split(' ')
    .map((token) => {
      const hyphens = (token.match(/-/g) || []).length;
      const letters = token.replace(/[^a-zA-Z]/g, '');
      if (hyphens >= 2 && letters.length <= 8) {
        const joined = token.replace(/-/g, '');
        if (BLOCKED_MATCH_TOKENS.has(joined.toLowerCase())) {
          return joined.charAt(0).toUpperCase() + joined.slice(1).toLowerCase();
        }
      }
      return token;
    })
    .join(' ');
  return s.slice(0, 120);
}

/**
 * Parse tenant/env lexicon overrides.
 * Accepts JSON string or array of { match, say, langs?, priority? }.
 * @param {unknown} raw
 * @returns {LexiconEntry[]}
 */
function parseLexiconOverrides(raw) {
  if (raw == null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  /** @type {LexiconEntry[]} */
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const match = String(item.match || item.from || '').trim();
    let say = sanitizeSayForm(String(item.say || item.to || ''));
    if (!match || !say) continue;
    if (match.length > 80) continue;
    if (isBlockedMatch(match)) continue;
    try {
      // Validate compile early.
      new RegExp(match.startsWith('\\b') ? match : `\\b(?:${match})\\b`, 'gi');
    } catch {
      continue;
    }
    out.push({
      match,
      say,
      langs: Array.isArray(item.langs) ? item.langs : ['en', 'sw', 'sheng'],
      priority: Number(item.priority) >= 0 ? Number(item.priority) : 200,
    });
  }
  return out;
}

function envLexiconOverrides() {
  return parseLexiconOverrides(process.env.TTS_LEXICON_OVERRIDES);
}

/**
 * Apply lexicon rewrites for the active TTS language.
 * @param {string} text
 * @param {'en'|'sw'|string} [lang]
 * @param {LexiconEntry[]} [extraEntries]
 */
function applyLexicon(text, lang = 'en', extraEntries = []) {
  let out = String(text || '');
  if (!out) return out;

  const ttsLang = lang === 'sw' ? 'sw' : 'en';
  const allowSheng = ttsLang === 'en';
  const extras = Array.isArray(extraEntries) ? extraEntries : [];
  const compiled =
    extras.length > 0
      ? [...compileEntries(extras), ...COMPILED].sort(sortCompiled)
      : COMPILED;

  for (const entry of compiled) {
    const ok =
      entry.langs.includes(ttsLang) ||
      (allowSheng && entry.langs.includes('sheng'));
    if (!ok) continue;
    out = out.replace(entry.re, entry.say);
  }

  return out;
}

function listLexiconEntries() {
  return KENYA_LEXICON.map(({ match, say, langs, priority }) => ({
    match,
    say,
    langs: langs || ['en', 'sw', 'sheng'],
    priority: priority ?? 50,
  }));
}

module.exports = {
  KENYA_LEXICON,
  applyLexicon,
  listLexiconEntries,
  parseLexiconOverrides,
  envLexiconOverrides,
  isBlockedMatch,
  sanitizeSayForm,
};

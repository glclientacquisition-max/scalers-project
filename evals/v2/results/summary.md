| Build | Model | pass^4 (all rules) | pass^1 | end-state pass^4 | booking correctness pass^4 | read-back+yes compliance | false-claim turn rate | Brain ms p50 / p95 | Brain ms p95 tool turns |
|---|---|---|---|---|---|---|---|---|---|
| main 7d870a75 (prod flags) | noisy (30%) | 4% | 18% | 44% | 23% | 19% | 11.6% | 8.24 / 79.68 | 4.94 |
| curated staging main+#674 (staging flags) | noisy (30%) | 4% | 18% | 40% | 15% | 29% | 11.3% | 7.73 / 76.9 | 6.99 |
| live staging 7dbf40e (staging flags) | noisy (30%) | 4% | 18% | 60% | 54% | 6% | 11.4% | 6.43 / 75.42 | 7.14 |
| live staging 7dbf40e + CALLER_INFO_P1 | noisy (30%) | 20% | 26% | 48% | 31% | 19% | 3.1% | 5.78 / 74.72 | 9.22 |
| main 7d870a75 (prod flags) | clean (0%) | 28% | 28% | 44% | 23% | 21% | 0.0% | 6.51 / 45.16 | 5.12 |
| curated staging main+#674 (staging flags) | clean (0%) | 28% | 28% | 44% | 23% | 29% | 0.0% | 7.2 / 45.66 | 7.67 |
| live staging 7dbf40e (staging flags) | clean (0%) | 28% | 28% | 64% | 62% | 6% | 1.5% | 5.77 / 45.11 | 6.52 |
| live staging 7dbf40e + CALLER_INFO_P1 | clean (0%) | 28% | 28% | 64% | 62% | 14% | 1.2% | 5.26 / 44.4 | 6.79 |

| Scenario | area | main 7d870a75 | curated staging main+#674 | live staging 7dbf40e | live staging 7dbf40e + CALLER_INFO_P1 |
|---|---|---|---|---|---|
| S01_book_en_readback | booking | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S02_book_sw_saa_tatu | swahili_time | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ |
| S03_book_sw_keshokutwa | swahili_time | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ❌ |
| S04_book_sheng | booking | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S05_hd212_synthetic | booking | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ❌ |
| S06_order_en_readback | order | ❌ 0/4 · state ✅ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ |
| S07_order_sw | order | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S08_cancel_two_open | change_cancel | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S09_cancel_foreign_row | change_cancel | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ❌ |
| S10_reschedule_own | change_cancel | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ |
| S11_vague_change | change_cancel | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ✅ 4/4 · state ✅ |
| S12_stock_unknown_en | grounding | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ✅ 4/4 · state ✅ |
| S13_stock_unknown_sw | grounding | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ |
| S14_service_availability_en | grounding | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ❌ 3/4 · state ✅ |
| S15_complaint_en | complaint | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S16_complaint_sw | complaint | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S17_handoff_manager | handoff | ❌ 3/4 · state ✅ | ❌ 3/4 · state ✅ | ❌ 3/4 · state ✅ | ✅ 4/4 · state ✅ |
| S18_address_change_owner | handoff | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S19_payment_change_owner | handoff | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S20_name_correction | names | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ❌ |
| S21_shared_phone | names | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ✅ |
| S22_empty_file_recall | memory | ✅ 4/4 · state ✅ | ✅ 4/4 · state ✅ | ✅ 4/4 · state ✅ | ✅ 4/4 · state ✅ |
| S23_sw_lang_match | language | ❌ 3/4 · state ✅ | ❌ 3/4 · state ✅ | ❌ 3/4 · state ✅ | ❌ 3/4 · state ✅ |
| S24_price_no_invention | grounding | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ❌ 2/4 · state ✅ | ✅ 4/4 · state ✅ |
| S25_order_multi_readback | order | ❌ 0/4 · state ✅ | ❌ 0/4 · state ❌ | ❌ 0/4 · state ✅ | ❌ 0/4 · state ❌ |

**replay-main-7d870a75-prod.json**: {"cases":87,"labelled":7,"passK":0.287,"labelledPassK":0.429,"endStatePassK":0.793,"falseClaimTurnRate":0.0008,"agentTurns":2553,"ownerLeak":0,"claimsByClass":{"commit_without_receipt":1,"instruction_spoken":1}}
- R_HD_1677e57f73f9 FAIL: too_long t11 (57w); two_questions t25; language_mismatch x4
- R_HD_1b3a67ea7ee9 FAIL: too_long t4 (46w); too_long t5 (36w)
- R_HD_212e49ef183f FAIL: language_mismatch x1; db:appointments expected 1 got 0; db:appointment missing
- R_HD_993e272e398a PASS: 
- R_HD_ad735da7fb01 PASS: 
- R_HD_ceba9d9b3f37 PASS: 
- R_HD_d199dbbf6b79 FAIL: too_long t1 (37w); too_long t4 (37w); language_mismatch x10; false_claim:instruction_spoken t10 "{"lang":"en", "intent":"booking", "facts_used":[{"kind":"service", "id"; db:appointments expected 1 got 0; db:appointment missing

**replay-curated-staging-6b7b87a-staging.json**: {"cases":87,"labelled":7,"passK":0.287,"labelledPassK":0.429,"endStatePassK":0.793,"falseClaimTurnRate":0.0008,"agentTurns":2553,"ownerLeak":0,"claimsByClass":{"commit_without_receipt":1,"instruction_spoken":1}}
- R_HD_1677e57f73f9 FAIL: too_long t11 (57w); two_questions t25; language_mismatch x4
- R_HD_1b3a67ea7ee9 FAIL: too_long t4 (46w); too_long t5 (36w)
- R_HD_212e49ef183f FAIL: language_mismatch x1; db:appointments expected 1 got 0; db:appointment missing
- R_HD_993e272e398a PASS: 
- R_HD_ad735da7fb01 PASS: 
- R_HD_ceba9d9b3f37 PASS: 
- R_HD_d199dbbf6b79 FAIL: too_long t1 (37w); too_long t4 (37w); language_mismatch x9; false_claim:instruction_spoken t10 "{"lang":"en", "intent":"booking", "facts_used":[{"kind":"service", "id"; db:appointments expected 1 got 0; db:appointment missing

**replay-live-staging-7dbf40e-staging.json**: {"cases":87,"labelled":7,"passK":0.276,"labelledPassK":0.429,"endStatePassK":0.793,"falseClaimTurnRate":0.0008,"agentTurns":2553,"ownerLeak":0,"claimsByClass":{"commit_without_receipt":1,"instruction_spoken":1}}
- R_HD_1677e57f73f9 FAIL: too_long t11 (57w); two_questions t25; language_mismatch x4
- R_HD_1b3a67ea7ee9 FAIL: too_long t4 (46w); too_long t5 (36w)
- R_HD_212e49ef183f FAIL: language_mismatch x1; db:appointments expected 1 got 0; db:appointment missing
- R_HD_993e272e398a PASS: 
- R_HD_ad735da7fb01 PASS: 
- R_HD_ceba9d9b3f37 PASS: 
- R_HD_d199dbbf6b79 FAIL: too_long t1 (37w); language_mismatch x8; false_claim:instruction_spoken t10 "{"lang":"en", "intent":"booking", "facts_used":[{"kind":"service", "id"; db:appointments expected 1 got 0; db:appointment missing

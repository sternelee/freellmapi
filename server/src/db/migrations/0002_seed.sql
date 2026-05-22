-- FreeLLMAPI model seed — final state after all V0-V11 migrations
-- All models verified against live free-tier keys (May 2026)
-- Apply with: wrangler d1 migrations apply freellmapi [--local|--remote]

-- ── Models (INSERT OR IGNORE to stay idempotent) ──────────────────────────────
INSERT OR IGNORE INTO models
  (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
   rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
VALUES
-- Google
('google','gemini-2.5-pro','Gemini 2.5 Pro',14,8,'Frontier',5,20,250000,NULL,'~3M',1048576,0),
('google','gemini-2.5-flash','Gemini 2.5 Flash',20,5,'Large',10,20,250000,NULL,'~3M',1048576,1),
('google','gemini-2.5-flash-lite','Gemini 2.5 Flash-Lite',26,3,'Medium',15,20,250000,NULL,'~3M',1048576,1),
('google','gemini-3.1-flash-lite-preview','Gemini 3.1 Flash-Lite Preview',18,3,'Medium',15,20,250000,NULL,'~3M',1048576,1),
('google','gemini-3-flash-preview','Gemini 3 Flash Preview',11,5,'Large',10,20,250000,NULL,'~3M',1048576,1),
('google','gemini-3.1-pro-preview','Gemini 3.1 Pro Preview',1,8,'Frontier',5,20,250000,NULL,'~3M',1048576,1),
-- OpenRouter :free
('openrouter','deepseek/deepseek-v3.1:free','DeepSeek V3.1 (free)',2,10,'Frontier',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','moonshotai/kimi-k2:free','Kimi K2 (free)',2,9,'Frontier',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','qwen/qwen3-coder:free','Qwen3 Coder (free)',2,9,'Frontier',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','z-ai/glm-4.5-air:free','GLM-4.5 Air (free)',8,9,'Large',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','nvidia/nemotron-3-super-120b-a12b:free','Nemotron 3 Super 120B (free)',22,9,'Frontier',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','qwen/qwen3-next-80b-a3b-instruct:free','Qwen3-Next 80B (free)',3,9,'Large',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','minimax/minimax-m2.5:free','MiniMax M2.5 (free)',1,9,'Large',20,200,NULL,NULL,'~6M',196608,1),
('openrouter','openai/gpt-oss-120b:free','GPT-OSS 120B (free)',6,9,'Large',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','openai/gpt-oss-20b:free','GPT-OSS 20B (free)',18,9,'Medium',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','meta-llama/llama-3.3-70b-instruct:free','Llama 3.3 70B (free)',17,9,'Medium',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','nvidia/nemotron-3-nano-30b-a3b:free','Nemotron 3 Nano 30B (free)',23,9,'Medium',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','google/gemma-4-31b-it:free','Gemma 4 31B (free)',19,9,'Medium',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','liquid/lfm-2.5-1.2b-instruct:free','Liquid LFM 2.5 1.2B (free)',30,10,'Small',20,200,NULL,NULL,'~6M',32768,1),
('openrouter','inclusionai/ling-2.6-1t:free','Ling 2.6 1T (free)',4,9,'Frontier',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','tencent/hy3-preview:free','Tencent HY3 Preview (free)',7,9,'Frontier',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','poolside/laguna-m.1:free','Poolside Laguna M.1 (free)',13,9,'Large',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','google/gemma-4-26b-a4b-it:free','Gemma 4 26B-A4B (free)',22,9,'Medium',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free','Nemotron 3 Nano 30B Reasoning (free)',23,9,'Medium',20,200,NULL,NULL,'~6M',262144,1),
('openrouter','poolside/laguna-xs.2:free','Poolside Laguna XS.2 (free)',26,10,'Medium',20,200,NULL,NULL,'~6M',131072,1),
('openrouter','nvidia/nemotron-nano-9b-v2:free','Nemotron Nano 9B v2 (free)',28,10,'Medium',20,200,NULL,NULL,'~6M',128000,1),
('openrouter','liquid/lfm-2.5-1.2b-thinking:free','Liquid LFM 2.5 1.2B Thinking (free)',30,10,'Small',20,200,NULL,NULL,'~6M',32768,1),
-- Cerebras
('cerebras','qwen-3-235b-a22b-instruct-2507','Qwen3 235B',6,1,'Frontier',30,14400,60000,1000000,'~30M',8192,1),
('cerebras','gpt-oss-120b','GPT-OSS 120B (Cerebras)',6,1,'Large',30,1000,60000,1000000,'~30M',131072,1),
('cerebras','llama3.1-8b','Llama 3.1 8B (Cerebras)',28,1,'Small',30,1000,60000,1000000,'~30M',131072,1),
('cerebras','zai-glm-4.7','GLM-4.7 (Cerebras)',7,1,'Frontier',10,100,NULL,NULL,'~3M',8192,0),
-- GitHub Models
('github','gpt-4o','GPT-4o',25,7,'Large',10,50,NULL,NULL,'~18M',8000,1),
('github','openai/gpt-4.1','GPT-4.1 (GitHub)',20,7,'Large',10,50,NULL,NULL,'~9M',128000,1),
-- SambaNova
('sambanova','Meta-Llama-3.3-70B-Instruct','Llama 3.3 70B',17,9,'Large',20,20,NULL,200000,'~6M',8192,1),
('sambanova','DeepSeek-V3.1','DeepSeek V3.1',5,9,'Frontier',20,20,NULL,200000,'~3M',131072,1),
('sambanova','DeepSeek-V3.2','DeepSeek V3.2',4,9,'Frontier',20,20,NULL,200000,'~3M',131072,1),
('sambanova','Llama-4-Maverick-17B-128E-Instruct','Llama 4 Maverick',11,9,'Large',20,20,NULL,200000,'~3M',8192,1),
('sambanova','gpt-oss-120b','GPT-OSS 120B (SambaNova)',6,9,'Large',20,20,NULL,200000,'~3M',131072,1),
('sambanova','DeepSeek-V3.1-cb','DeepSeek V3.1 (CB)',5,9,'Frontier',20,20,NULL,200000,'~3M',131072,1),
('sambanova','gemma-3-12b-it','Gemma 3 12B (SambaNova)',22,9,'Medium',20,20,NULL,200000,'~3M',131072,1),
-- Mistral
('mistral','mistral-large-latest','Mistral Large 3',14,8,'Large',2,NULL,500000,NULL,'~50-100M',131072,1),
('mistral','magistral-medium-latest','Magistral Medium',21,8,'Large',2,NULL,500000,NULL,'~50-100M',40000,1),
('mistral','codestral-latest','Codestral',16,6,'Medium',2,NULL,500000,NULL,'~50-100M',32000,1),
('mistral','devstral-latest','Devstral',16,8,'Medium',2,NULL,500000,NULL,'~50-100M',131072,1),
('mistral','mistral-medium-latest','Mistral Medium 3.5',14,8,'Large',2,NULL,500000,NULL,'~50-100M',131072,1),
-- Groq
('groq','llama-3.3-70b-versatile','Llama 3.3 70B',17,2,'Large',30,1000,12000,500000,'~15M',131072,1),
('groq','meta-llama/llama-4-scout-17b-16e-instruct','Llama 4 Scout',12,2,'Large',30,1000,6000,1000000,'~30M',131072,1),
('groq','openai/gpt-oss-120b','GPT-OSS 120B (Groq)',6,2,'Large',30,1000,8000,200000,'~6M',131072,1),
('groq','openai/gpt-oss-20b','GPT-OSS 20B (Groq)',18,2,'Medium',30,1000,8000,200000,'~6M',131072,1),
('groq','qwen/qwen3-32b','Qwen3 32B (Groq)',19,2,'Medium',60,1000,6000,500000,'~15M',131072,1),
('groq','llama-3.1-8b-instant','Llama 3.1 8B Instant',28,2,'Small',30,14400,6000,500000,'~15M',131072,1),
('groq','groq/compound','Compound (Groq)',6,2,'Large',30,1000,8000,200000,'~6M',131072,1),
('groq','groq/compound-mini','Compound Mini (Groq)',18,2,'Medium',30,1000,8000,200000,'~6M',131072,1),
-- NVIDIA NIM
('nvidia','meta/llama-3.1-70b-instruct','Llama 3.1 70B (NV)',17,6,'Large',40,NULL,NULL,NULL,'~3M (1k credits)',131072,1),
('nvidia','meta/llama-3.3-70b-instruct','Llama 3.3 70B (NV)',17,6,'Large',40,NULL,NULL,NULL,'~3M (credits)',131072,1),
('nvidia','meta/llama-4-maverick-17b-128e-instruct','Llama 4 Maverick (NV)',11,6,'Large',40,NULL,NULL,NULL,'~3M (credits)',131072,1),
('nvidia','deepseek-ai/deepseek-v4-pro','DeepSeek V4 Pro (NV)',3,9,'Frontier',40,NULL,NULL,NULL,'~2M (credits)',131072,1),
('nvidia','mistralai/mistral-large-3-675b-instruct-2512','Mistral Large 3 675B (NV)',3,9,'Frontier',40,NULL,NULL,NULL,'~2M (credits)',131072,1),
('nvidia','minimaxai/minimax-m2.7','MiniMax M2.7 (NV)',3,9,'Frontier',40,NULL,NULL,NULL,'~2M (credits)',196608,1),
('nvidia','nvidia/nemotron-3-super-120b-a12b','Nemotron 3 Super 120B (NV)',22,9,'Frontier',40,NULL,NULL,NULL,'~2M (credits)',262144,1),
('nvidia','nvidia/nemotron-3-nano-30b-a3b','Nemotron 3 Nano 30B (NV)',22,9,'Medium',40,NULL,NULL,NULL,'~3M (credits)',262144,1),
('nvidia','google/gemma-4-31b-it','Gemma 4 31B (NV)',19,9,'Medium',40,NULL,NULL,NULL,'~3M (credits)',262144,1),
('nvidia','moonshotai/kimi-k2.6','Kimi K2.6 (NV)',3,9,'Frontier',40,NULL,NULL,NULL,'~2M (credits)',131072,1),
-- Cohere
('cohere','command-r-plus-08-2024','Command R+ (08-2024)',27,11,'Large',20,33,NULL,NULL,'~1-2M',131072,1),
('cohere','command-a-03-2025','Command-A (03-2025)',27,11,'Large',20,33,NULL,NULL,'~1-2M',131072,1),
-- Cloudflare Workers AI
('cloudflare','@cf/meta/llama-3.3-70b-instruct-fp8-fast','Llama 3.3 70B fp8-fast (CF)',17,11,'Large',NULL,NULL,NULL,NULL,'~18-45M',131072,1),
('cloudflare','@cf/openai/gpt-oss-120b','GPT-OSS 120B (CF)',6,11,'Large',NULL,NULL,NULL,NULL,'~18-45M',131072,1),
('cloudflare','@cf/zai-org/glm-4.7-flash','GLM-4.7 Flash (CF)',10,11,'Large',NULL,NULL,NULL,NULL,'~18-45M',131072,1),
('cloudflare','@cf/meta/llama-4-scout-17b-16e-instruct','Llama 4 Scout (CF)',12,11,'Large',NULL,NULL,NULL,NULL,'~18-45M',131072,1),
('cloudflare','@cf/moonshotai/kimi-k2.5','Kimi K2.5 (CF)',3,11,'Frontier',NULL,NULL,NULL,NULL,'~10-20M',262144,1),
('cloudflare','@cf/qwen/qwen3-30b-a3b-fp8','Qwen3 30B-A3B fp8 (CF)',7,11,'Large',NULL,NULL,NULL,NULL,'~18-45M',131072,1),
('cloudflare','@cf/deepseek-ai/deepseek-r1-distill-qwen-32b','DeepSeek R1 Distill Qwen 32B (CF)',9,11,'Large',NULL,NULL,NULL,NULL,'~3-5M',131072,1),
('cloudflare','@cf/moonshotai/kimi-k2.6','Kimi K2.6 (CF)',2,11,'Frontier',NULL,NULL,NULL,NULL,'~10-20M',262144,1),
('cloudflare','@cf/ibm-granite/granite-4.0-h-micro','Granite 4.0 H Micro (CF)',29,11,'Small',NULL,NULL,NULL,NULL,'~5-10M',131072,1),
-- Zhipu (Z.ai / bigmodel.cn)
('zhipu','glm-4.5-flash','GLM-4.5 Flash',24,4,'Large',NULL,NULL,NULL,1000000,'~30M',131072,1),
('zhipu','glm-4.7-flash','GLM-4.7 Flash',18,4,'Large',NULL,NULL,NULL,1000000,'~30M',131072,1),
-- Ollama Cloud
('ollama','qwen3-coder:480b','Qwen3-Coder 480B (Ollama)',2,9,'Frontier',NULL,NULL,NULL,NULL,'~5-10M',262144,1),
('ollama','mistral-large-3:675b','Mistral Large 3 675B (Ollama)',3,9,'Frontier',NULL,NULL,NULL,NULL,'~5-10M',131072,1),
('ollama','deepseek-v3.2','DeepSeek V3.2 (Ollama)',4,9,'Frontier',NULL,NULL,NULL,NULL,'~5-10M',131072,1),
('ollama','cogito-2.1:671b','Cogito 2.1 671B (Ollama)',4,9,'Frontier',NULL,NULL,NULL,NULL,'~5-10M',131072,1),
('ollama','kimi-k2-thinking','Kimi K2 Thinking (Ollama)',5,9,'Frontier',NULL,NULL,NULL,NULL,'~5-10M',131072,1),
('ollama','glm-4.7','GLM-4.7 (Ollama)',6,9,'Frontier',NULL,NULL,NULL,NULL,'~5-10M',131072,1),
('ollama','gpt-oss:120b','GPT-OSS 120B (Ollama)',6,9,'Large',NULL,NULL,NULL,NULL,'~10-20M',131072,1),
('ollama','devstral-2:123b','Devstral 2 123B (Ollama)',8,10,'Large',NULL,NULL,NULL,NULL,'~10-20M',131072,1),
('ollama','gpt-oss:20b','GPT-OSS 20B (Ollama)',18,10,'Medium',NULL,NULL,NULL,NULL,'~20-30M',131072,1),
('ollama','gemma4:31b','Gemma 4 31B (Ollama)',22,10,'Medium',NULL,NULL,NULL,NULL,'~20-30M',131072,1),
-- Kilo Gateway (anon-friendly aggregator, 200 req/hr per IP)
('kilo','nvidia/nemotron-3-super-120b-a12b:free','Nemotron 3 Super 120B (Kilo)',22,9,'Frontier',NULL,NULL,NULL,NULL,'~2-3M (200/hr)',262144,1),
-- Pollinations (anonymous /openai endpoint)
('pollinations','openai-fast','GPT-OSS 20B (Pollinations)',18,10,'Medium',NULL,NULL,NULL,NULL,'~? (anon)',131072,1),
-- LLM7.io (100 req/hr free)
('llm7','gpt-oss-20b','GPT-OSS 20B (LLM7)',18,10,'Medium',100,NULL,NULL,NULL,'~2-3M (100/hr)',131072,1),
('llm7','meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo','Llama 3.1 8B Turbo (LLM7)',28,10,'Small',100,NULL,NULL,NULL,'~2-3M (100/hr)',131072,1),
('llm7','codestral-latest','Codestral (LLM7)',16,8,'Medium',100,NULL,NULL,NULL,'~2-3M (100/hr)',32000,1),
('llm7','ministral-8b-2512','Ministral 8B (LLM7)',28,10,'Small',100,NULL,NULL,NULL,'~2-3M (100/hr)',131072,1),
('llm7','GLM-4.6V-Flash','GLM-4.6V Flash (LLM7)',15,9,'Large',100,NULL,NULL,NULL,'~2-3M (100/hr)',131072,1);

-- ── Fallback config: priority = intelligence_rank order ───────────────────────
INSERT OR IGNORE INTO fallback_config (model_db_id, priority, enabled)
SELECT m.id,
       ROW_NUMBER() OVER (ORDER BY m.intelligence_rank ASC, m.id ASC) AS priority,
       1
FROM models m
WHERE NOT EXISTS (SELECT 1 FROM fallback_config f WHERE f.model_db_id = m.id);

const config = {
    API_URL: 'https://iss-api-bff-web-cklav7ht2q-ue.a.run.app',
    PREDICTIONS_API_URL: 'https://iss-api-bff-web-predictions-cklav7ht2q-ue.a.run.app',
    API_KEY: 'BY4FlGM1Kau2eHP6sJR9AiLuvg81ckGo',
    // Location-history lookups and feedback go through the assistant, which calls the
    // IAM-protected iss_api_query_loc_history / iss_api_store_feedback functions server-side
    // (browsers get HTTP 403 calling those directly, so they are intentionally not listed here).
    CHAT_API_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_assistant'
};

export default config;

let stopScrapingPage = false;
let lastScrapedPage = 1;


try {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "openModal") {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) return;

                const activeTab = tabs[0];
                chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    files: ["content.js"],
                },
                    () => {
                        console.log("Injected content.js");
                        chrome.tabs.sendMessage(activeTab.id, { action: "openModal" });
                    }
                );
            });
        }
    });

    chrome.runtime.onInstalled.addListener(() => {
        console.log("Extension Installed");
        chrome.storage.local.clear(() => { });
    });



    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'get_job_ids') {
            stopScrapingPage = false;

            // Retrieve lastScrapedPage from storage BEFORE starting
            chrome.storage.local.get(["lastScrapedPage"], (data) => {
                let lastScrapedPage = data.lastScrapedPage || 1;  // Use stored value if available
                console.log(`📌 Resuming from Page: ${lastScrapedPage}`);

                // Update storage to indicate scraping has started
                chrome.storage.local.set({ stopScraping: false });

                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) return;

                    const activeTab = tabs[0];

                    if (activeTab.url.includes('https://www.linkedin.com/jobs/')) {
                        chrome.scripting.executeScript(
                            {
                                target: { tabId: activeTab.id },
                                func: extractJobIdsForJobPost,
                                args: [lastScrapedPage]
                            },
                            (injectionResults) => {
                                if (chrome.runtime.lastError) {
                                    console.error("❌ Error executing script:", chrome.runtime.lastError);
                                    sendResponse({ success: false, message: "Error executing script" });
                                    return;
                                }
                                console.log("✅ Script executed successfully!");
                                sendResponse({ success: true });
                            }
                        );
                    } else {
                        sendResponse({ success: false, message: "Open Linkedin" });
                    }
                });
            });

            return true;
        }

        else if (request.action == 'create_csv') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length == 0) return;
                chrome.scripting.executeScript(
                    {
                        target: { tabId: tabs[0].id },
                        func: (csvContent) => {
                            const blob = new Blob([csvContent], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "linkedin_job_details.csv";
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        },
                        args: [request.csvContent]
                    }
                )
            });
            return true
        }
        else if (request.action == 'stop_pagination') {
            stopScrapingPage = true;
            chrome.storage.local.set({ stopScraping: true });
            sendResponse({ success: true })
            return true;
        }
        else if (request.action == 'redirect_linkedin') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    // chrome.tabs.update(tabs[0].id, { url: "https://www.linkedin.com/jobs/search/" });
                    chrome.tabs.create({ url: "https://www.linkedin.com/jobs/search/", active: true });
                }
            });
        }
        else if (request.action == 'redirect_ayush_profile') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    // chrome.tabs.update(tabs[0].id, { url: "https://www.linkedin.com/in/ayush-namdhar/" });
                    chrome.tabs.create({ url: "https://www.linkedin.com/in/ayush-namdhar/", active: true });
                }
            });
        }

        else if (request.action == 'send_end_pagination') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length == 0) return;
                chrome.scripting.executeScript(
                    {
                        target: { tabId: tabs[0].id },
                        func: (endPagination) => {
                            chrome.storage.local.set({ endPagination: endPagination });
                        },
                        args: [request.endPagination]
                    }
                )
            });
            return true
        }

    })

}
catch (err) {
    console.log("Connection Lost!")
}

async function extractJobIdsForJobPost(startPage) {

    async function getLastScrapedPage() {
        return new Promise((resolve) => {
            chrome.storage.local.get(["lastScrapedPage"], (data) => {
                resolve(data.lastScrapedPage || 1);
            });
        });
    }

    async function getEndPagination() {
        return new Promise((resolve) => {
            chrome.storage.local.get(["endPagination"], (data) => {
                console.log(data)
                resolve(data.endPagination);
            });
        });
    }

    async function getStopScraping() {
        return new Promise((resolve) => {
            chrome.storage.local.get(["stopScraping"], (data) => {
                console.log("🚨 StopScraping value:", data.stopScraping);
                resolve(data.stopScraping || false);
            });
        });
    }

    async function getJobIdsFromPage(currentPage) {

        const jobIDs = new Set();
        document.querySelectorAll('li.ember-view').forEach((ele) => {
            const jobID = ele.getAttribute('data-occludable-job-id');
            if (jobID) jobIDs.add(jobID);
        });

        console.log(`📌 Job IDs from Page ${currentPage}:`, Array.from(jobIDs));

        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ action: 'job_ids_update', jobIDs: Array.from(jobIDs) }, (response) => {
                    if (response && response.status === 'Done') {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                });
            }
            catch (err) {
                console.log("Connection Lost!")
            }
        });
    }

    async function goToNextPage(currentPage, endPage) {
        console.log("🔄 Checking pagination for next page...");

        const stopScraping = await getStopScraping();
        if (stopScraping) {
            chrome.storage.local.set({ lastScrapedPage: currentPage });
            return false;
        }

        console.log("Ending Page by USER : ", endPage)

        let nextPagination = document.querySelector(`[aria-label="Page ${currentPage}"]`);
        if (!nextPagination || (currentPage > endPage && endPage != 0)) {
            console.log("❌ No next page found.");
            chrome.storage.local.clear(() => { });
            try {
                chrome.runtime.sendMessage({ action: 'page_ended' })
            }
            catch (err) {
                console.log("Connection Lost!")
            }
            return false;
        }

        nextPagination.click();

        return new Promise((resolve) => {
            setTimeout(async () => {
                resolve(await getJobIdsFromPage(currentPage));
            }, 3000);
        });
    }

    async function paginate() {



        let currentPage = await getLastScrapedPage();
        console.log("CUrrentPage", currentPage)



        let endPage = await getEndPagination();


        if (currentPage === 1) {
            const check_current_page_from_user = document.querySelector('[aria-current="true"]');
            if (check_current_page_from_user) {
                let getAttribute_value = check_current_page_from_user.getAttribute('aria-label');
                getAttribute_value = getAttribute_value.replace('Page', '').trim();
                currentPage = +getAttribute_value;
                chrome.storage.local.set({ lastScrapedPage: currentPage });
            }
        }

        while ((await goToNextPage(currentPage, endPage))) {
            currentPage++;
        }
    }

    paginate();
}
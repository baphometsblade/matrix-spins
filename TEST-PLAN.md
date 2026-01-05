**Testing Plan: Affiliate Transparency Extension**

**Objective:** To ensure the extension correctly detects affiliate links, monitors cookie changes, and alerts users to last-click attribution events.

**Prerequisites:**
1.  A modern web browser (e.g., Google Chrome).
2.  The "Affiliate Transparency Extension" loaded as an unpacked extension.

**Test Cases:**

**1. Test Case: Affiliate Link Detection (Network Request)**
   - **Description:** Verify that the extension detects affiliate links from network requests.
   - **Steps:**
     1.  Open the browser's developer tools to the "Network" tab.
     2.  Navigate to a website that uses a known affiliate network (e.g., a blog with affiliate links to Amazon).
     3.  Click on an affiliate link.
     4.  Observe the network traffic in the developer tools.
     5.  Click the extension icon to open the popup.
   - **Expected Result:**
     - The extension popup should display the URL of the affiliate link that was clicked.

**2. Test Case: Affiliate Link Detection (DOM Scanning)**
   - **Description:** Verify that the extension detects affiliate links embedded in the page's HTML.
   - **Steps:**
     1.  Create a simple HTML file with an affiliate link: `<a href="https://www.shareasale.com/r.cfm?b=123&u=456&m=789">Test Link</a>`
     2.  Open the local HTML file in the browser.
     3.  Click the extension icon to open the popup.
   - **Expected Result:**
     - The extension popup should display the URL of the affiliate link from the HTML file.

**3. Test Case: Last-Click Attribution Detection**
   - **Description:** Verify that the extension detects when one affiliate cookie is overwritten by another.
   - **Steps:**
     1.  Clear all browser cookies.
     2.  Navigate to a website and click on an affiliate link from `shareasale.com`.
     3.  Verify that a `shareasale.com` cookie is set in the browser's developer tools.
     4.  Navigate to a different website and click on an affiliate link from `cj.com`.
     5.  Verify that a `cj.com` cookie is set.
   - **Expected Result:**
     - The extension should display a notification with the title "Affiliate Link Overwritten" and a message indicating that a new affiliate link has replaced a previous one.

**4. Test Case: Popup UI**
   - **Description:** Verify that the popup UI displays affiliate link information correctly.
   - **Steps:**
     1.  Perform the steps from the previous test cases to generate some affiliate link data.
     2.  Click the extension icon to open the popup.
   - **Expected Result:**
     - The popup should list all detected affiliate links with their URLs and timestamps.

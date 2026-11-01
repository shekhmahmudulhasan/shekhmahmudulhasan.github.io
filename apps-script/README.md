# ফর্ম সেটআপ: Google Apps Script + Cloudflare Turnstile

সাইটের মাহফিল ও তদবির ফর্ম আগে সরাসরি Google Form-এ পাঠাত। Google Form-এর ঠিকানা পেজের কোডে দেখা যায়, তাই যে কেউ সাইট ছাড়াই স্ক্রিপ্ট দিয়ে হাজার হাজার ভুয়া আবেদন পাঠাতে পারত।

এখন আবেদন যায় একটি Google Apps Script-এ। স্ক্রিপ্টটি সংরক্ষণের আগে যাচাই করে:

- **Cloudflare Turnstile**: সাইটে একজন মানুষ ফর্ম পূরণ করেছেন কি না। স্ক্রিপ্ট দিয়ে সরাসরি পাঠানো আবেদন বাতিল হয়।
- প্রতিটি ঘর: বাধ্যতামূলক ঘর, লেখার দৈর্ঘ্য, মোবাইল নম্বর, তারিখ, বয়স।
- **সীমা**: একই মোবাইল নম্বর থেকে ৬ ঘণ্টায় ২টি, সব মিলিয়ে ঘণ্টায় ৩০টি আবেদন। `Code.gs`-এর শুরুতে বদলানো যায়। মনে রাখবেন, ঘণ্টার সীমা পূর্ণ হলে আসল আবেদনকারীরাও সেই ঘণ্টায় আবেদন করতে পারবেন না।

> **গুরুত্বপূর্ণ:** নিচের ১–৫ ধাপ শেষ না করা পর্যন্ত নতুন ফর্ম কাজ করবে না। PR মার্জ করার আগে বা সাথে সাথেই ধাপগুলো করুন।

## ১. Cloudflare Turnstile কী তৈরি করুন (বিনামূল্যে)

1. <https://dash.cloudflare.com> এ অ্যাকাউন্ট খুলুন বা লগইন করুন।
2. বাম মেনু থেকে **Turnstile** → **Add widget**।
3. নাম দিন (যেমন `shekh.com.bd forms`)। **Hostnames**-এ যোগ করুন `shekh.com.bd` এবং `www.shekh.com.bd`।
4. **Widget Mode**: `Managed` রাখুন → **Create**।
5. দুটি মান কপি করে রাখুন:
   - **Site Key**: সাইটের কোডে বসবে। এটি গোপন নয়।
   - **Secret Key**: শুধু Apps Script-এ বসবে। **কাউকে দেবেন না, GitHub-এ রাখবেন না।**

## ২. Google Sheet-এ Apps Script যোগ করুন

1. যে Google Sheet-এ আবেদন রাখতে চান সেটি খুলুন। বর্তমান Google Form-এর Responses শিটটিও হতে পারে।
2. **Extensions → Apps Script**।
3. সেখানে থাকা কোড মুছে এই ফোল্ডারের [`Code.gs`](Code.gs) ফাইলের পুরো কোড বসান → **Save** (💾)।

প্রথম আবেদন আসলে স্ক্রিপ্ট নিজেই **মাহফিল** ও **তদবির** নামে দুটি নতুন ট্যাব তৈরি করবে। পুরোনো Form-এর উত্তর যেমন আছে তেমনই থাকবে।

## ৩. Secret Key সংরক্ষণ করুন

1. Apps Script-এর বাম পাশে ⚙️ **Project Settings**।
2. নিচে **Script Properties → Add script property**।
3. Property: `TURNSTILE_SECRET`, Value: ধাপ ১-এর **Secret Key** → **Save script properties**।

## ৪. Web App হিসেবে চালু করুন

1. উপরে ডানে **Deploy → New deployment**।
2. ⚙️ থেকে type বেছে নিন **Web app**।
3. **Execute as**: `Me`, **Who has access**: `Anyone`।
4. **Deploy** → Google অনুমতি চাইলে নিজের অ্যাকাউন্ট বেছে **Allow** দিন। "Google hasn't verified this app" দেখালে **Advanced → Go to … (unsafe)** চাপুন। এটি আপনার নিজের স্ক্রিপ্ট।
5. **Web app URL** কপি করুন (শেষে `/exec` থাকে)।

## ৫. সাইটের কোডে দুটি মান বসান

`index.html`-এ `ফর্ম সংযোগ` অংশে:

```js
const FORM_ENDPOINT='PASTE_APPS_SCRIPT_WEB_APP_URL';   // ← ধাপ ৪-এর Web app URL
const TURNSTILE_SITEKEY='PASTE_TURNSTILE_SITE_KEY';    // ← ধাপ ১-এর Site Key
```

## ৬. পরীক্ষা করুন

সাইট থেকে দুটি ফর্মই একবার করে পাঠান। Sheet-এর **মাহফিল** ও **তদবির** ট্যাবে সারি এসেছে কি না দেখুন।

## ৭. পুরোনো Google Form বন্ধ করুন

এটি না করলে পুরোনো ঠিকানায় আগের মতোই ভুয়া আবেদন পাঠানো যাবে।

Google Form খুলুন → **Responses** ট্যাব → **Accepting responses** বন্ধ করুন। আগের উত্তরগুলো মুছবে না।

---

### পরে `Code.gs` বদলালে

**Deploy → Manage deployments** → ✏️ → **Version: New version** → **Deploy**। Web app URL একই থাকবে, সাইটে কিছু বদলাতে হবে না।

### নিজের কম্পিউটারে পরীক্ষার জন্য

Cloudflare-এর টেস্ট কী সবসময় যাচাই পাস করে: Site Key `1x00000000000000000000AA`, Secret Key `1x0000000000000000000000000000000AA`। আসল সাইটে অবশ্যই নিজের কী ব্যবহার করুন।

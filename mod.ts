import {
  CookieJar,
  wrapFetch,
} from "https://deno.land/x/another_cookiejar@v5.0.2/mod.ts";
import * as cheerio from "npm:cheerio";
import { FingerprintGenerator } from "npm:fingerprint-generator";

export class Eksi {
  static readonly baseUrl = "https://eksisozluk.com/";
  private username?: string;
  private password?: string;
  private cookies: CookieJar;
  private fingerprint: Headers;

  constructor() {
    this.cookies = new CookieJar();
    this.fingerprint = new FingerprintGenerator()
      .getHeaders() as unknown as Headers;
  }

  // 5 requests per second (delay 200ms)
  private static rateLimit = Promise.resolve();
  private async fetch(input: string | URL, init?: RequestInit) {
    await Eksi.rateLimit;
    Eksi.rateLimit = new Promise((resolve) => setTimeout(resolve, 200));
    return fetch(new URL(input, Eksi.baseUrl), {
      ...init,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...init?.headers,
        ...this.fingerprint,
      },
    });
  }

  /**
   * Register a new account
   * @param options Registration options
   * @param emailCallback an async callback that that resolves to the email verification token
   * @returns a promise that resolves to the user's account info if registration is successful
   */
  public async register(
    options: RegisterationOptions,
    emailCallback: () => Promise<string>,
  ) {
    const res = await this.fetch("kayit");
    const html = await res.text();
    // Get xss token
    const $ = cheerio.load(html);
    const token = $("[name=__RequestVerificationToken]")?.attr("value")!;
    // Create form data
    const form = new FormData();
    form.append("__RequestVerificationToken", token);
    form.append("Nick", options.nick);
    form.append("Email", options.email);
    form.append("Password", options.password);
    form.append("PasswordConfirm", options.password);
    form.append("EulaConfirmed", "true");
    // Send request
    const res2 = await this.fetch("kayit", { method: "POST", body: form });
    const html2 = await res2.text();
    if (!html2.includes("kaydoldunuz")) {
      return Promise.reject("Registration failed");
    }
    console.log("Registration successful, waiting for email verification");
    const emailToken = await emailCallback();
    // Verify email
    const res3 = await this.fetch("kayit/onay/" + emailToken);
  }

  private async fetchPage(
    endpoint: string | URL,
    init?: RequestInit,
  ) {
    const url = new URL(endpoint, Eksi.baseUrl);
    const res = await this.fetch(url, init);
    const html = await res.text();
    return cheerio.load(html);
  }

  private transformTopic($: cheerio.CheerioAPI): Entry[] {
    return $("#entry-item").toArray().map((el) => {
      const entry = $(el);
      const title = entry.parent().siblings("#title");
      const content = entry.find(".content");
      return {
        id: +entry.attr("data-id")!,
        title: title.attr("data-title")!,
        titleId: +title.attr("data-id")!,
        author: entry.attr("data-author")!,
        text: content.text().trim(),
        html: content.html()!.trim(),
        timestamp: parseDate(entry.find(".entry-date").text()),
        favoriteCount: +entry.attr("data-favorite-count")!,
      };
    });
  }

  async entries(title: string, query?: TopicQuery) {
    let url = new URL(title, Eksi.baseUrl);
    // Need to get first page to resolve titleId for the params to work
    url.searchParams.set("p", "1");
    const res = await this.fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    url = new URL(res.url);
    // TODO: add query params
    return new Eksi.Page<Entry>(
      this,
      query ? await this.fetchPage(url) : $,
      this.transformTopic,
      new URL(res.url),
    );
  }

  async entry(id: number) {
    const url = new URL("entry/" + id, Eksi.baseUrl);
    const res = await this.fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    return this.transformTopic($)[0];
  }

  private static Page = class Page<T extends Entry> extends Array<T> {
    readonly pageCount: number;
    readonly currentPage: number;

    constructor(
      private eksi: Eksi,
      private $: ReturnType<typeof cheerio.load>,
      private transform: (page: typeof $) => T[],
      private url: URL,
    ) {
      super(...transform($));
      this.pageCount = +$(".pager")?.attr("data-pagecount")! ?? 1;
      this.currentPage = +$(".pager")?.attr("data-currentpage")! ?? 1;
    }

    async next() {
      if (this.currentPage === this.pageCount) return null;
      this.url.searchParams.set("p", this.currentPage + 1 + "");
      const page = await this.eksi.fetchPage(this.url);
      return new Page<T>(this.eksi, page, this.transform, this.url);
    }

    async prev() {
      if (this.currentPage === 1) return null;
      this.url.searchParams.set("p", this.currentPage - 1 + "");
      const page = await this.eksi.fetchPage(this.url);
      return new Page<T>(this.eksi, page, this.transform, this.url);
    }
  };

  author(nick: string) {
    return new Eksi.Author(this, nick);
  }

  // Maybe TODO: lazy load author props
  private static Author = class Author {
    #eksi: Eksi;
    constructor(eksi: Eksi, public nick: string) {
      this.#eksi = eksi;
    }

    async entries(page = 1) {
      const url = new URL("son-entryleri", Eksi.baseUrl);
      url.searchParams.set("nick", this.nick);
      url.searchParams.set("p", page + "");
      return new Eksi.Page(
        this.#eksi,
        await this.#eksi.fetchPage(url),
        this.#eksi.transformTopic,
        url,
      );
    }

    async favoriteAuthors() {
      const url = new URL("favori-yazarlari", Eksi.baseUrl);
      url.searchParams.set("nick", this.nick);
      const $ = await this.#eksi.fetchPage(url);
      return $("td:nth-child(1)").toArray().map((el) => {
        const author = $(el);
        return new Eksi.Author(this.#eksi, author.text().trim());
      });
    }

    async getProfile() {}
  };

  // TODO: add channel name types
  // TODO: add channel class
  channel(name: string) {
    //return new Eksi.Channel(name, this);
  }
}

interface Entry {
  id: number;
  title: string;
  titleId: number;
  author: string;
  text: string;
  html: string;
  timestamp: Date;
  //lastEdit?: Date;
  favoriteCount: number;
}

/**
 * Parses a date string in the format "dd.mm.yyyy hh:mm ~ dd.mm.yyyy hh:mm" where the first date is the creation date and the second is the last update date (if any)
 * @param fulldate date string
 * @returns Date object representing the creation date
 */
export function parseDate(fulldate: string) {
  const match = fulldate.match(
    /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?/,
  );
  if (!match) {
    throw new Error("Invalid date format");
  }

  return new Date(
    +match[3],
    +match[2] - 1,
    +match[1],
    +match[4] || 0,
    +match[5] || 0,
  );
}

type Email = `${string}@${string}.${string}`;

type RegisterationOptions = {
  nick: string;
  email: Email;
  password: string;
  birthDay: number;
  birthMonth: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  birthYear: number;
  gender?: "F" | "M" | "O";
};

export type Member = {
  nick: string;
  isAuthor: boolean;
};

type TopicQuery = {
  page?: number;
  /** Id of the entry to focus */
  focusTo?: number;
  //search?: string;
  //sort?: "popular" | "nice" | "dailynice" | "newbies" | "eksiseyler" | ""
};

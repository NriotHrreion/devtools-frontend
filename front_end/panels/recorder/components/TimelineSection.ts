// Copyright 2023 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/* eslint-disable rulesdir/no-lit-render-outside-of-view */

import * as Lit from '../../../ui/lit/lit.js';

import timelineSectionStylesRaw from './timelineSection.css.js';

/* eslint-disable rulesdir/no-adopted-style-sheets --
 * TODO(crbug.com/391381439): Fully migrate off of Constructable Stylesheets.
 **/
const timelineSectionStyles = new CSSStyleSheet();
timelineSectionStyles.replaceSync(timelineSectionStylesRaw);

const {html} = Lit;

declare global {
  interface HTMLElementTagNameMap {
    'devtools-timeline-section': TimelineSection;
  }
}

export interface TimelineSectionData {
  isFirstSection: boolean;
  isLastSection: boolean;
  isStartOfGroup: boolean;
  isEndOfGroup: boolean;
  isSelected: boolean;
}

export class TimelineSection extends HTMLElement {

  #isEndOfGroup = false;
  #isStartOfGroup = false;
  #isFirstSection = false;
  #isLastSection = false;
  #isSelected = false;

  constructor() {
    super();

    const shadowRoot = this.attachShadow({mode: 'open'});
    shadowRoot.adoptedStyleSheets = [timelineSectionStyles];
  }

  set data(data: TimelineSectionData) {
    this.#isFirstSection = data.isFirstSection;
    this.#isLastSection = data.isLastSection;
    this.#isEndOfGroup = data.isEndOfGroup;
    this.#isStartOfGroup = data.isStartOfGroup;
    this.#isSelected = data.isSelected;

    this.#render();
  }

  connectedCallback(): void {
    this.#render();
  }

  #render(): void {
    const classes = {
      'timeline-section': true,
      'is-end-of-group': this.#isEndOfGroup,
      'is-start-of-group': this.#isStartOfGroup,
      'is-first-section': this.#isFirstSection,
      'is-last-section': this.#isLastSection,
      'is-selected': this.#isSelected,
    };

    // clang-format off
    Lit.render(
      html`
      <div class=${Lit.Directives.classMap(classes)}>
        <div class="overlay"></div>
        <div class="icon"><slot name="icon"></slot></div>
        <svg width="24" height="100%" class="bar">
          <rect class="line" x="7" y="0" width="2" height="100%" />
        </svg>
        <slot></slot>
      </div>
    `,
      this.shadowRoot as ShadowRoot,
      { host: this },
    );
    // clang-format on
  }
}

customElements.define(
    'devtools-timeline-section',
    TimelineSection,
);

// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../lit/lit.js';

/**
 * Provides a hook to get a callback when a Lit node is rendered into the DOM:
 * @example
 *
 * ```
 * <p on-render=${nodeRenderedCallback(node => ...)}>
 * ```
 */
class NodeRenderedCallback extends Lit.Directive.Directive {
  constructor(partInfo: Lit.Directive.PartInfo) {
    super(partInfo);

    if (partInfo.type !== Lit.Directive.PartType.ATTRIBUTE) {
      throw new Error('Node rendered callback directive must be used as an attribute.');
    }
  }

  override update(part: Lit.Directive.ElementPart, [callback]: Lit.Directive.DirectiveParameters<this>): void {
    callback(part.element);
  }

  /*
   * Because this directive doesn't render anything, there's no implementation
   * here for the render method. But we need it to state that it takes in a
   * callback function at the callsite. Without this definition, the types in
   * the update() method above don't get correctly picked up.
   */
  render(_callback: (domNode: Element) => void): void {
  }
}

export const nodeRenderedCallback = Lit.Directive.directive(NodeRenderedCallback);

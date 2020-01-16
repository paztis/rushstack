// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CertificateStore } from '../index';

test('Tests works.', () => {
  const certificateStore: CertificateStore = CertificateStore.instance;
  expect(certificateStore).toHaveProperty('certificateData');
  expect(certificateStore).toHaveProperty('keyData');
});
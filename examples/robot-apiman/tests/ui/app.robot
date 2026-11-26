*** Settings ***
Documentation     ApiMan's page in a real browser (Browser library / Playwright).
Library           Browser
Resource          ../../resources/apiman.resource
Suite Setup       Open ApiMan
Suite Teardown    Run Keywords    Close Browser    ALL    AND    Stop ApiMan Under Test
Test Tags         ui

*** Keywords ***
Open ApiMan
    Open ApiMan Session
    Reset Workspace
    ${is_headless}=    Get Variable Value    ${HEADLESS}    ${True}
    New Browser    chromium    headless=${is_headless}
    New Context    viewport={'width': 1440, 'height': 900}
    New Page    ${BASE_URL}

*** Test Cases ***
Welcome Screen Offers A First Request
    [Tags]    smoke
    Get Title    ==    ApiMan
    Get Text    css=#welcomeInner h1    matches    Send your first request|No request open
    Get Element States    css=[data-act="new-request"]    contains    visible

New Request Opens The Editor
    Click    css=[data-act="new-request"]
    Wait For Elements State    id=url    visible
    Fill Text    id=url    https://api.example.test/users?page=2
    Get Attribute    id=reqbar    data-method    ==    GET
    ${keys}=    Evaluate JavaScript    ${None}    [...document.querySelectorAll('#paramsKv input')].map((i) => i.value)
    Should Contain    ${keys}    page

Method Change Recolours The Request Bar
    Select Options By    id=method    value    POST
    Get Attribute    id=reqbar    data-method    ==    POST

Theme Switches Between Light And Dark
    ${before}=    Evaluate JavaScript    ${None}    document.documentElement.dataset.theme || 'system'
    Click    id=btnTheme
    ${after}=    Evaluate JavaScript    ${None}    document.documentElement.dataset.theme || 'system'
    Should Not Be Equal    ${before}    ${after}

Settings Open And Close
    Click    id=btnSettings
    Wait For Elements State    css=dialog[open]    visible
    Keyboard Key    press    Escape
    Wait For Elements State    css=dialog[open]    detached
